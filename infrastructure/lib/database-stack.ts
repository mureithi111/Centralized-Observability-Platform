import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';

import {
  Construct
} from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';

import * as rds from 'aws-cdk-lib/aws-rds';

export interface DatabaseStackProps extends cdk.StackProps {
  network: {
    vpc: ec2.IVpc;
    appSecurityGroup: ec2.ISecurityGroup;
    dbSecurityGroup: ec2.ISecurityGroup;
  };
}

export class DatabaseStack extends cdk.Stack {

  public readonly database: rds.DatabaseInstance;

  public readonly databaseSecret: rds.DatabaseSecret;

  public readonly databaseSubnetGroup: rds.SubnetGroup;

  constructor(
    scope: Construct,
    id: string,
    props: DatabaseStackProps
  ) {

    super(scope, id, props);

    // ==========================================
    // DATABASE SUBNET GROUP
    // ==========================================

    this.databaseSubnetGroup = new rds.SubnetGroup(
      this,
      'ObservabilityDatabaseSubnetGroup',
      {
        subnetGroupName: 'observability-db-subnet-group',

        description:
          'Isolated private subnets for the observability MySQL database',

        vpc: props.network.vpc,

        vpcSubnets: {
          subnetGroupName: 'database'
        },

        removalPolicy: cdk.RemovalPolicy.DESTROY
      }
    );

    // ==========================================
    // DATABASE CREDENTIALS
    // ==========================================

    this.databaseSecret = new rds.DatabaseSecret(
      this,
      'ObservabilityDatabaseSecret',
      {
        username: 'dbadmin',
        secretName: 'observability/rds/mysql',
        excludeCharacters: ' "/@\\'
      }
    );

    // ==========================================
    // MYSQL ENGINE
    // ==========================================

    const mysqlEngine = rds.DatabaseInstanceEngine.mysql({
      version: rds.MysqlEngineVersion.of(
        '8.4.11',
        '8.4'
      )
    });

        // ==========================================
    // MYSQL OBSERVABILITY PARAMETER GROUP
    // ==========================================

    const mysqlParameterGroup = new rds.ParameterGroup(
      this,
      'ObservabilityMySQLParameterGroup',
      {
        engine: mysqlEngine,

        description:
          'MySQL 8.4 logging configuration for centralized observability',

        parameters: {
          general_log: '1',
          slow_query_log: '1',
          long_query_time: '2',
          log_output: 'FILE'
        }
      }
    );

    // ==========================================
    // MYSQL DATABASE INSTANCE
    // ==========================================

    this.database = new rds.DatabaseInstance(
      this,
      'ObservabilityMySQLDatabase',
      {
        instanceIdentifier: 'observability-mysql',

        engine: mysqlEngine,

        parameterGroup: mysqlParameterGroup,

        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.BURSTABLE3,
          ec2.InstanceSize.MICRO
        ),

        databaseName: 'observabilitydb',

        credentials: rds.Credentials.fromSecret(
          this.databaseSecret
        ),

        // --------------------------------------
        // NETWORK CONFIGURATION
        // --------------------------------------

        vpc: props.network.vpc,

        subnetGroup: this.databaseSubnetGroup,

        vpcSubnets: {
          subnetGroupName: 'database'
        },

        securityGroups: [
          props.network.dbSecurityGroup
        ],

        port: 3306,

        publiclyAccessible: false,

        // --------------------------------------
        // STORAGE CONFIGURATION
        // --------------------------------------

        allocatedStorage: 20,

        maxAllocatedStorage: 100,

        storageType: rds.StorageType.GP2,

        storageEncrypted: true,

        // --------------------------------------
        // AVAILABILITY AND BACKUPS
        // --------------------------------------

        multiAz: false,

        backupRetention: cdk.Duration.days(7),

        preferredBackupWindow: '19:00-19:30',

        preferredMaintenanceWindow: 'sun:20:00-sun:20:30',

        copyTagsToSnapshot: true,

        // --------------------------------------
        // MONITORING
        // --------------------------------------

        monitoringInterval: cdk.Duration.seconds(60),

        enablePerformanceInsights: false,

        // --------------------------------------
        // CLOUDWATCH DATABASE LOG EXPORTS
        // --------------------------------------

        cloudwatchLogsExports: [
          'error',
          'general',
          'slowquery'
        ],

        cloudwatchLogsRetention:
          logs.RetentionDays.ONE_MONTH,

        // --------------------------------------
        // INSTANCE MANAGEMENT
        // --------------------------------------

        autoMinorVersionUpgrade: true,

        allowMajorVersionUpgrade: false,

        deletionProtection: false,

        deleteAutomatedBackups: true,

        removalPolicy: cdk.RemovalPolicy.DESTROY
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
      'DatabaseIdentifier',
      {
        value: this.database.instanceIdentifier,

        description: 'RDS MySQL database identifier'
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabaseEndpoint',
      {
        value: this.database.dbInstanceEndpointAddress,

        description: 'Private RDS MySQL endpoint'
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabasePort',
      {
        value: this.database.dbInstanceEndpointPort,

        description: 'MySQL database port'
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabaseName',
      {
        value: 'observabilitydb'
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabaseSecretArn',
      {
        value: this.databaseSecret.secretArn,

        description:
          'Secrets Manager ARN containing database credentials'
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabaseSubnetGroupName',
      {
        value: this.databaseSubnetGroup.subnetGroupName
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabaseSecurityGroupId',
      {
        value: props.network.dbSecurityGroup.securityGroupId
      }
    );

  }
}
