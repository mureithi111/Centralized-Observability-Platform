import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export class EcrStack extends cdk.Stack {

  public readonly repository: ecr.Repository;

  constructor(
    scope: Construct,
    id: string,
    props?: cdk.StackProps
  ) {

    super(scope, id, props);

    this.repository = new ecr.Repository(
      this,
      'ObservabilityApiRepository',
      {
        repositoryName: 'observability-api',

        imageScanOnPush: true,

        imageTagMutability: ecr.TagMutability.IMMUTABLE,

        lifecycleRules: [
          {
            description: 'Retain the latest 10 images',
            maxImageCount: 10
          }
        ],

        removalPolicy: cdk.RemovalPolicy.DESTROY,

        emptyOnDelete: true
      }
    );

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

    new cdk.CfnOutput(
      this,
      'EcrRepositoryName',
      {
        value: this.repository.repositoryName
      }
    );

    new cdk.CfnOutput(
      this,
      'EcrRepositoryUri',
      {
        value: this.repository.repositoryUri
      }
    );
  }
}
