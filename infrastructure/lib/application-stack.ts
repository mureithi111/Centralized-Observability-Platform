import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';

export interface ApplicationStackProps extends cdk.StackProps {

  network: {
    vpc: ec2.IVpc;
    appSecurityGroup: ec2.ISecurityGroup;
  };

  database: {
    instance: rds.DatabaseInstance;
    secret: secretsmanager.ISecret;
  };

  repository: ecr.IRepository;
}

export class ApplicationStack extends cdk.Stack {

  public readonly cluster: ecs.Cluster;

  public readonly taskDefinition: ecs.FargateTaskDefinition;

  public readonly service: ecs.FargateService;

  public readonly applicationLogGroup: logs.LogGroup;

  constructor(
    scope: Construct,
    id: string,
    props: ApplicationStackProps
  ) {

    super(scope, id, props);

    // ==========================================
    // CLOUDWATCH LOG GROUP
    // ==========================================

    this.applicationLogGroup = new logs.LogGroup(
      this,
      'ObservabilityApiLogGroup',
      {
        logGroupName: '/ecs/observability-api',

        retention: logs.RetentionDays.ONE_MONTH,

        removalPolicy: cdk.RemovalPolicy.DESTROY
      }
    );

    // ==========================================
    // ECS CLUSTER
    // ==========================================

    this.cluster = new ecs.Cluster(
      this,
      'ObservabilityEcsCluster',
      {
        clusterName: 'observability-cluster',

        vpc: props.network.vpc
      }
    );

    // ==========================================
    // PRIVATE CLOUD MAP DNS NAMESPACE
    // ==========================================

    const serviceNamespace = new servicediscovery.PrivateDnsNamespace(
      this,
      'ObservabilityServiceNamespace',
      {
        name: 'service.local',
        vpc: props.network.vpc,
        description: 'Private service discovery namespace for observability services'
      }
    );

    // ==========================================
    // ECS TASK EXECUTION ROLE
    // ==========================================

    const executionRole = new iam.Role(
      this,
      'ObservabilityEcsExecutionRole',
      {
        roleName: 'observability-ecs-execution-role',

        assumedBy: new iam.ServicePrincipal(
          'ecs-tasks.amazonaws.com'
        ),

        description:
          'Allows ECS to pull images, publish container logs, and retrieve application secrets'
      }
    );

    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AmazonECSTaskExecutionRolePolicy'
      )
    );

    // ECS retrieves these values when starting the container.
    // The secret value is never embedded in the task definition.
    props.database.secret.grantRead(executionRole);

    // ==========================================
    // ECS APPLICATION TASK ROLE
    // ==========================================

    const taskRole = new iam.Role(
      this,
      'ObservabilityApiTaskRole',
      {
        roleName: 'observability-api-task-role',

        assumedBy: new iam.ServicePrincipal(
          'ecs-tasks.amazonaws.com'
        ),

        description:
          'Application permissions for the observability FastAPI service'
      }
    );

    // Intentionally no additional application permissions yet.
    // X-Ray permissions will be added when ADOT is deployed.
    // CloudWatch EMF metrics are emitted through application logs.

    // Allow the ADOT sidecar to publish traces to AWS X-Ray.
taskRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'xray:PutTraceSegments',
      'xray:PutTelemetryRecords'
    ],
    resources: ['*']
  })
);

    // ==========================================
    // FARGATE TASK DEFINITION
    // ==========================================

    this.taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'ObservabilityApiTaskDefinition',
      {
        family: 'observability-api',

        cpu: 1024,

        memoryLimitMiB: 2048,

        executionRole,

        taskRole
      }
    );

    // ==========================================
    // FASTAPI CONTAINER
    // ==========================================

    const apiContainer = this.taskDefinition.addContainer(
      'ObservabilityApiContainer',
      {
        containerName: 'observability-api',

        image: ecs.ContainerImage.fromEcrRepository(
          props.repository,
          'phase12'
        ),

        essential: true,

        cpu: 512,

        memoryLimitMiB: 1024,

        environment: {

          APP_NAME: 'centralized-observability-api',

          APP_ENV: 'production',

          LOG_LEVEL: 'INFO',

          DB_HOST:
            props.database.instance.dbInstanceEndpointAddress,

          DB_PORT: '3306',

          DB_NAME: 'observabilitydb',

          OTEL_SERVICE_NAME:
            'centralized-observability-api',

          OTEL_TRACES_EXPORTER: 'otlp',

          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',

          OTEL_METRICS_EXPORTER: 'none',

          OTEL_LOGS_EXPORTER: 'none'
        },

        secrets: {

          DB_USER: ecs.Secret.fromSecretsManager(
            props.database.secret,
            'username'
          ),

          DB_PASSWORD: ecs.Secret.fromSecretsManager(
            props.database.secret,
            'password'
          )
        },

        logging: ecs.LogDrivers.awsLogs({
          logGroup: this.applicationLogGroup,

          streamPrefix: 'api'
        }),

        healthCheck: {
          command: [
            'CMD-SHELL',
            'curl -fsS http://127.0.0.1:8000/health/live || exit 1'
          ],

          interval: cdk.Duration.seconds(30),

          timeout: cdk.Duration.seconds(5),

          retries: 3,

          startPeriod: cdk.Duration.seconds(60)
        },

        stopTimeout: cdk.Duration.seconds(30)
      }
    );

    apiContainer.addPortMappings({
      containerPort: 8000,

      protocol: ecs.Protocol.TCP
    });

    // ==========================================
    // ADOT OPENTELEMETRY COLLECTOR SIDECAR
    // ==========================================

    const collectorContainer = this.taskDefinition.addContainer(
      'AdotCollectorContainer',
      {
        containerName: 'adot-collector',

        image: ecs.ContainerImage.fromEcrRepository(
          props.repository,
          'adot-v0-51-0'
        ),

        essential: true,

        cpu: 256,

        memoryLimitMiB: 512,

        environment: {
          AWS_REGION: 'us-east-1'
        },

        logging: ecs.LogDrivers.awsLogs({
          logGroup: this.applicationLogGroup,
          streamPrefix: 'adot'
        })
      }
    );

    // Start the Collector before the API container.
    apiContainer.addContainerDependencies({
      container: collectorContainer,
      condition: ecs.ContainerDependencyCondition.START
    });

    // ==========================================
    // FARGATE SERVICE
    // ==========================================

    this.service = new ecs.FargateService(
      this,
      'ObservabilityApiService',
      {
        serviceName: 'observability-api-service',

        cluster: this.cluster,

        taskDefinition: this.taskDefinition,

        desiredCount: 2,

        assignPublicIp: false,

        vpcSubnets: {
          subnetGroupName: 'app'
        },

        securityGroups: [
          props.network.appSecurityGroup
        ],

        minHealthyPercent: 50,

        maxHealthyPercent: 200,

        circuitBreaker: {
          rollback: true
        },

        enableECSManagedTags: true,

        // Register Fargate task IPs in private DNS.
        cloudMapOptions: {
          name: 'observability-api',
          cloudMapNamespace: serviceNamespace,
          dnsRecordType: servicediscovery.DnsRecordType.A,
          dnsTtl: cdk.Duration.seconds(10),
          container: apiContainer,
          containerPort: 8000
        }
      }
    );

    // ==========================================
    // RESOURCE TAGS
    // ==========================================

    cdk.Tags.of(this).add(
      'Project',
      'centralized-observability'
    );

    cdk.Tags.of(this).add(
      'Environment',
      'devops-capstone'
    );

    cdk.Tags.of(this).add(
      'ManagedBy',
      'AWS-CDK'
    );

    // ==========================================
    // CLOUDFORMATION OUTPUTS
    // ==========================================

    new cdk.CfnOutput(
      this,
      'EcsClusterName',
      {
        value: this.cluster.clusterName
      }
    );

    new cdk.CfnOutput(
      this,
      'EcsServiceName',
      {
        value: this.service.serviceName
      }
    );

    new cdk.CfnOutput(
      this,
      'EcsTaskDefinitionArn',
      {
        value: this.taskDefinition.taskDefinitionArn
      }
    );

    new cdk.CfnOutput(
      this,
      'ApplicationLogGroupName',
      {
        value: this.applicationLogGroup.logGroupName
      }
    );

    new cdk.CfnOutput(
      this,
      'ApplicationSecurityGroupId',
      {
        value: props.network.appSecurityGroup.securityGroupId
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabaseEndpoint',
      {
        value:
          props.database.instance.dbInstanceEndpointAddress
      }
    );
  }
}
