import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

import * as sns from 'aws-cdk-lib/aws-sns';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export interface RemediationStackProps extends cdk.StackProps {
  cluster: ecs.ICluster;
  service: ecs.IService;
}

export class RemediationStack extends cdk.Stack {

  public readonly remediationFunction: lambda.Function;

  public readonly alarmStateRule: events.Rule;

  constructor(
    scope: Construct,
    id: string,
    props: RemediationStackProps
  ) {
    super(scope, id, props);

    const operationalAlertsTopic = sns.Topic.fromTopicArn(
  this,
  'ExistingOperationalAlertsTopic',
  'arn:aws:sns:us-east-1:345549356290:observability-alerts'
);

    // ==========================================
    // LAMBDA REMEDIATION FUNCTION
    // ==========================================

    this.remediationFunction = new lambda.Function(
      this,
      'ObservabilityRemediationFunction',
      {
        functionName: 'observability-alarm-remediation',

        description:
          'Processes CloudWatch alarm events and performs bounded ECS remediation',

        runtime: lambda.Runtime.NODEJS_22_X,

        handler: 'index.handler',

        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            '../../monitoring/lambda/remediation'
          )
        ),

        memorySize: 256,

        timeout: cdk.Duration.seconds(30),


        environment: {
          ECS_CLUSTER: props.cluster.clusterName,
          ECS_SERVICE: props.service.serviceName,
          SNS_TOPIC_ARN: operationalAlertsTopic.topicArn
        }
      }
    );

    // ==========================================
    // LEAST-PRIVILEGE ECS PERMISSIONS
    // ==========================================

    this.remediationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,

        actions: [
          'ecs:DescribeServices',
          'ecs:UpdateService'
        ],

        resources: [
          props.service.serviceArn
        ]
      })
    );

    // ==========================================
// LEAST-PRIVILEGE SNS PUBLISH PERMISSION
// ==========================================

operationalAlertsTopic.grantPublish(
  this.remediationFunction
);

    // ==========================================
    // EVENTBRIDGE ALARM STATE CHANGE RULE
    // ==========================================

    this.alarmStateRule = new events.Rule(
      this,
      'ObservabilityAlarmStateChangeRule',
      {
        ruleName: 'observability-alarm-state-change',

        description:
          'Routes monitored CloudWatch alarm state changes to the remediation Lambda',

        eventPattern: {
          source: [
            'aws.cloudwatch'
          ],

          detailType: [
            'CloudWatch Alarm State Change'
          ],

          detail: {
            alarmName: [
              'Observability-ALB-HTTP5xx',
              'Observability-ApplicationErrorCount',
              'Observability-ApplicationErrors',
              'Observability-DatabaseErrors',
              'Observability-ECS-HighCPU',
              'Observability-Http5xxErrors'
            ],

            state: {
              value: [
                'ALARM',
                'OK'
              ]
            }
          }
        }
      }
    );

    // ==========================================
    // EVENTBRIDGE LAMBDA TARGET
    // ==========================================

    this.alarmStateRule.addTarget(
      new targets.LambdaFunction(
        this.remediationFunction,
        {
          retryAttempts: 5,

          maxEventAge: cdk.Duration.hours(2)
        }
      )
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
      'RemediationLambdaName',
      {
        value: this.remediationFunction.functionName
      }
    );

    new cdk.CfnOutput(
      this,
      'RemediationLambdaArn',
      {
        value: this.remediationFunction.functionArn
      }
    );

    new cdk.CfnOutput(
      this,
      'EventBridgeRuleName',
      {
        value: this.alarmStateRule.ruleName
      }
    );

    new cdk.CfnOutput(
      this,
      'RemediationEcsCluster',
      {
        value: props.cluster.clusterName
      }
    );

    new cdk.CfnOutput(
      this,
      'RemediationEcsService',
      {
        value: props.service.serviceName
      }
    );
  }
}
