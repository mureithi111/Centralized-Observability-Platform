import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';

export class ArchiveStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const account = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // S3 archive bucket
    const archiveBucket = new s3.Bucket(this, 'ObservabilityLogArchive', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30)
            }
          ],
          expiration: cdk.Duration.days(365),
          noncurrentVersionExpiration: cdk.Duration.days(365)
        }
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Firehose delivery role
    const firehoseRole = new iam.Role(this, 'FirehoseS3DeliveryRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com')
    });

    firehoseRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:AbortMultipartUpload',
        's3:GetBucketLocation',
        's3:GetObject',
        's3:ListBucket',
        's3:ListBucketMultipartUploads',
        's3:PutObject'
      ],
      resources: [
        archiveBucket.bucketArn,
        archiveBucket.arnForObjects('*')
      ]
    }));

    // Firehose delivery stream
    const deliveryStream = new firehose.CfnDeliveryStream(
      this,
      'ObservabilityLogDeliveryStream',
      {
        deliveryStreamName: 'observability-cloudwatch-archive',
        deliveryStreamType: 'DirectPut',
        extendedS3DestinationConfiguration: {
          bucketArn: archiveBucket.bucketArn,
          roleArn: firehoseRole.roleArn,
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 5
          },
          compressionFormat: 'GZIP',
          prefix: 'cloudwatch-logs/!{timestamp:yyyy}/!{timestamp:MM}/!{timestamp:dd}/',
          errorOutputPrefix: 'firehose-errors/!{firehose:error-output-type}/!{timestamp:yyyy}/!{timestamp:MM}/',
          processingConfiguration: {
            enabled: true,
            processors: [
              {
                type: 'Decompression',
                parameters: [
                  {
                    parameterName: 'CompressionFormat',
                    parameterValue: 'GZIP'
                  }
                ]
              },
              {
                type: 'CloudWatchLogProcessing',
                parameters: [
                  {
                    parameterName: 'DataMessageExtraction',
                    parameterValue: 'true'
                  }
                ]
              }
            ]
          }
        }
      }
    );

    // CloudWatch Logs subscription role
    const cloudWatchRole = new iam.Role(this, 'CloudWatchLogsToFirehoseRole', {
      assumedBy: new iam.ServicePrincipal('logs.amazonaws.com', {
        conditions: {
          StringLike: {
            'aws:SourceAccount': account
          },
          ArnLike: {
            'aws:SourceArn': `arn:aws:logs:${region}:${account}:*`
          }
        }
      })
    });

    cloudWatchRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'firehose:PutRecord',
        'firehose:PutRecordBatch'
      ],
      resources: [deliveryStream.attrArn]
    }));

    // Existing application, web and database log groups
    const sourceLogGroups = [
      '/ec2/observability-web',
      '/ecs/observability-api',
      '/aws/rds/instance/observability-mysql/error',
      '/aws/rds/instance/observability-mysql/general',
      '/aws/rds/instance/observability-mysql/slowquery'
    ];

    sourceLogGroups.forEach((logGroupName, index) => {
      const subscription = new logs.CfnSubscriptionFilter(
        this,
        `ArchiveSubscription${index + 1}`,
        {
          destinationArn: deliveryStream.attrArn,
          filterName: `ArchiveToFirehose${index + 1}`,
          filterPattern: '',
          logGroupName,
          roleArn: cloudWatchRole.roleArn
        }
      );

      subscription.node.addDependency(deliveryStream);
      subscription.node.addDependency(
        cloudWatchRole.node.findChild('DefaultPolicy')
      );
    });

    new cdk.CfnOutput(this, 'ArchiveBucketName', {
      value: archiveBucket.bucketName
    });

    new cdk.CfnOutput(this, 'FirehoseDeliveryStreamName', {
      value: deliveryStream.deliveryStreamName!
    });

    new cdk.CfnOutput(this, 'FirehoseDeliveryStreamArn', {
      value: deliveryStream.attrArn
    });
  }
}
