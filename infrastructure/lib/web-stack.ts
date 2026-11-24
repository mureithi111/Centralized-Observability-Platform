import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface WebStackProps extends cdk.StackProps {
  network: {
    vpc: ec2.IVpc;
    albSecurityGroup: ec2.ISecurityGroup;
    webSecurityGroup: ec2.ISecurityGroup;
  };
}

export class WebStack extends cdk.Stack {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  public readonly webAutoScalingGroup: autoscaling.AutoScalingGroup;

  public readonly webLogGroup: logs.LogGroup;

  constructor(
    scope: Construct,
    id: string,
    props: WebStackProps
  ) {
    super(scope, id, props);

    // ==========================================
    // CLOUDWATCH LOG GROUP
    // ==========================================

    this.webLogGroup = new logs.LogGroup(
      this,
      'ObservabilityWebLogGroup',
      {
        logGroupName: '/ec2/observability-web',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      }
    );

    // ==========================================
    // EC2 INSTANCE IAM ROLE
    // ==========================================

    const webInstanceRole = new iam.Role(
      this,
      'ObservabilityWebInstanceRole',
      {
        roleName: 'observability-web-instance-role',

        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),

        description:
          'Allows the web EC2 instance to use Systems Manager and publish Nginx logs to CloudWatch'
      }
    );

    webInstanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonSSMManagedInstanceCore'
      )
    );

    webInstanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'CloudWatchAgentServerPolicy'
      )
    );

    // ==========================================
    // EC2 USER DATA
    // ==========================================

    const userData = ec2.UserData.forLinux();

    userData.addCommands(
      'set -euxo pipefail',

      // Install Nginx.
      'dnf update -y',
      'dnf install -y nginx',

      // Install the official CloudWatch Agent RPM.
      'curl -fsSLo /tmp/amazon-cloudwatch-agent.rpm https://amazoncloudwatch-agent.s3.amazonaws.com/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm',
      'dnf install -y /tmp/amazon-cloudwatch-agent.rpm',
      'rm -f /tmp/amazon-cloudwatch-agent.rpm',

      // Configure Nginx to resolve the ECS Cloud Map service dynamically.
      'cat > /etc/nginx/conf.d/observability.conf <<\'NGINX\'',
      'server {',
      '    listen 80;',
      '    server_name _;',
      '',
      '    resolver 169.254.169.253 valid=10s ipv6=off;',
      '    set $api_backend observability-api.service.local;',
      '',
      '    access_log /var/log/nginx/access.log;',
      '    error_log /var/log/nginx/error.log warn;',
      '',
      '    location / {',
      '        proxy_pass http://$api_backend:8000;',
      '        proxy_http_version 1.1;',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '        proxy_connect_timeout 5s;',
      '        proxy_read_timeout 60s;',
      '    }',
      '}',
      'NGINX',

      // Remove the default Nginx server configuration.
      'rm -f /etc/nginx/conf.d/default.conf',

      // Configure CloudWatch Agent to collect Nginx logs.
      'mkdir -p /opt/aws/amazon-cloudwatch-agent/etc',

            'cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<\'CWAGENT\'',
      '{',
      '  "agent": {',
      '    "metrics_collection_interval": 60,',
      '    "run_as_user": "root"',
      '  },',
      '  "metrics": {',
      '    "namespace": "CWAgent",',
      '    "append_dimensions": {',
      '      "InstanceId": "${aws:InstanceId}"',
      '    },',
      '    "metrics_collected": {',
      '      "cpu": {',
      '        "measurement": [',
      '          "cpu_usage_idle",',
      '          "cpu_usage_user",',
      '          "cpu_usage_system"',
      '        ],',
      '        "totalcpu": true,',
      '        "metrics_collection_interval": 60',
      '      },',
      '      "mem": {',
      '        "measurement": [',
      '          "mem_used_percent"',
      '        ],',
      '        "metrics_collection_interval": 60',
      '      },',
      '      "disk": {',
      '        "measurement": [',
      '          "used_percent"',
      '        ],',
      '        "resources": [',
      '          "/"',
      '        ],',
      '        "metrics_collection_interval": 60',
      '      }',
      '    }',
      '  },',
      '  "logs": {',
      '    "logs_collected": {',
      '      "files": {',
      '        "collect_list": [',
      '          {',
      '            "file_path": "/var/log/nginx/access.log",',
      '            "log_group_name": "/ec2/observability-web",',
      '            "log_stream_name": "{instance_id}/nginx-access",',
      '            "timezone": "UTC"',
      '          },',
      '          {',
      '            "file_path": "/var/log/nginx/error.log",',
      '            "log_group_name": "/ec2/observability-web",',
      '            "log_stream_name": "{instance_id}/nginx-error",',
      '            "timezone": "UTC"',
      '          }',
      '        ]',
      '      }',
      '    }',
      '  }',
      '}',
      'CWAGENT',

      // Start Nginx and CloudWatch Agent.
      'nginx -t',
      'systemctl enable nginx',
      'systemctl restart nginx',

      '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s'
    );

    // ==========================================
    // EC2 AUTO SCALING GROUP
    // ==========================================

    this.webAutoScalingGroup = new autoscaling.AutoScalingGroup(
      this,
      'ObservabilityWebAutoScalingGroup',
      {
        autoScalingGroupName: 'observability-web-asg',

        vpc: props.network.vpc,

        vpcSubnets: {
          subnetGroupName: 'web'
        },

        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.MICRO
        ),

        machineImage: ec2.MachineImage.latestAmazonLinux2023(),

        securityGroup: props.network.webSecurityGroup,

        role: webInstanceRole,

        userData,

        minCapacity: 1,

        maxCapacity: 1,

        desiredCapacity: 1,

        associatePublicIpAddress: false,

        healthCheck: autoscaling.HealthCheck.elb({
          grace: cdk.Duration.minutes(5)
        }),

        updatePolicy: autoscaling.UpdatePolicy.rollingUpdate(),

        cooldown: cdk.Duration.seconds(120)
      }
    );

    // ==========================================
    // INTERNET-FACING APPLICATION LOAD BALANCER
    // ==========================================

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      'ObservabilityApplicationLoadBalancer',
      {
        loadBalancerName: 'observability-web-alb',

        vpc: props.network.vpc,

        internetFacing: true,

        securityGroup: props.network.albSecurityGroup,

        vpcSubnets: {
          subnetGroupName: 'public'
        },

        deletionProtection: false
      }
    );

    // ==========================================
    // HTTP LISTENER
    // ==========================================

    const httpListener = this.loadBalancer.addListener(
      'ObservabilityHttpListener',
      {
        port: 80,

        open: false
      }
    );

    // ==========================================
    // WEB TIER TARGET GROUP
    // ==========================================

    httpListener.addTargets(
      'ObservabilityWebTargets',
      {
        port: 80,

        protocol: elbv2.ApplicationProtocol.HTTP,

        targets: [
          this.webAutoScalingGroup
        ],

        healthCheck: {
          path: '/health/live',

          protocol: elbv2.Protocol.HTTP,

          port: '80',

          healthyHttpCodes: '200',

          interval: cdk.Duration.seconds(30),

          timeout: cdk.Duration.seconds(5),

          healthyThresholdCount: 2,

          unhealthyThresholdCount: 3
        },

        deregistrationDelay: cdk.Duration.seconds(30)
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
      'WebLoadBalancerDnsName',
      {
        value: this.loadBalancer.loadBalancerDnsName,

        description: 'Public DNS name of the observability web ALB'
      }
    );

    new cdk.CfnOutput(
      this,
      'WebLoadBalancerArn',
      {
        value: this.loadBalancer.loadBalancerArn
      }
    );

    new cdk.CfnOutput(
      this,
      'WebAutoScalingGroupName',
      {
        value: this.webAutoScalingGroup.autoScalingGroupName
      }
    );

    new cdk.CfnOutput(
      this,
      'WebLogGroupName',
      {
        value: this.webLogGroup.logGroupName
      }
    );

    new cdk.CfnOutput(
      this,
      'WebInstanceRoleArn',
      {
        value: webInstanceRole.roleArn
      }
    );
  }
}
