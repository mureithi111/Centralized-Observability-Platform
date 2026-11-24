#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';

import { WebStack } from '../lib/web-stack';

import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { EcrStack } from '../lib/ecr-stack';
import { ApplicationStack } from '../lib/application-stack';
import { ArchiveStack } from '../lib/archive-stack';
import { RemediationStack } from '../lib/remediation-stack';

const app = new cdk.App();

// ==========================================
// AWS ENVIRONMENT
// ==========================================

const account = process.env.CDK_DEFAULT_ACCOUNT;

const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

if (!account) {
  throw new Error(
    'CDK_DEFAULT_ACCOUNT is missing. Run aws sts get-caller-identity first.'
  );
}

if (region !== 'us-east-1') {
  throw new Error(
    `Incorrect deployment region: ${region}. Expected us-east-1.`
  );
}

const environment: cdk.Environment = {
  account,
  region
};

// ==========================================
// PHASE 10: NETWORK STACK
// ==========================================

const networkStack = new NetworkStack(
  app,
  'ObservabilityNetworkStack',
  {
    env: environment,

    description:
      'Networking infrastructure for centralized observability platform'
  }
);

// ==========================================
// PHASE 11: DATABASE STACK
// ==========================================

const databaseStack = new DatabaseStack(
  app,
  'ObservabilityDatabaseStack',
  {
    env: environment,

    network: {
      vpc: networkStack.vpc,

      appSecurityGroup: networkStack.appSecurityGroup,

      dbSecurityGroup: networkStack.dbSecurityGroup
    },

    description:
      'Private encrypted MySQL database for centralized observability platform'
  }
);

databaseStack.addDependency(networkStack);

// ==========================================
// PHASE 12A: ECR STACK
// ==========================================

const ecrStack = new EcrStack(
  app,
  'ObservabilityEcrStack',
  {
    env: environment,

    description:
      'Private Amazon ECR repository for the observability FastAPI application'
  }
);

// ==========================================
// PHASE 12B: ECS APPLICATION STACK
// ==========================================

const applicationStack = new ApplicationStack(
  app,
  'ObservabilityApplicationStack',
  {
    env: environment,

    network: {
      vpc: networkStack.vpc,

      appSecurityGroup: networkStack.appSecurityGroup
    },

    database: {
      instance: databaseStack.database,

      secret: databaseStack.databaseSecret
    },

    repository: ecrStack.repository,

    description:
      'ECS Fargate application tier for centralized observability platform'
  }
);

// Explicit infrastructure dependencies.
applicationStack.addDependency(networkStack);
applicationStack.addDependency(databaseStack);
applicationStack.addDependency(ecrStack);


// ==========================================
// PHASE 13: WEB TIER AND APPLICATION LOAD BALANCER
// ==========================================

const webStack = new WebStack(
  app,
  'ObservabilityWebStack',
  {
    env: environment,

    network: {
      vpc: networkStack.vpc,

      albSecurityGroup: networkStack.albSecurityGroup,

      webSecurityGroup: networkStack.webSecurityGroup
    },

    description:
      'Internet-facing ALB and private EC2 Nginx web tier for centralized observability platform'
  }
);

// The web tier depends on the VPC and the ECS service
// because Nginx proxies to the ECS Cloud Map DNS name.
webStack.addDependency(networkStack);
webStack.addDependency(applicationStack);


// ==========================================
// PHASE 15: CENTRALIZED LOG ARCHIVING
// ==========================================

const archiveStack = new ArchiveStack(
  app,
  'ObservabilityArchiveStack',
  {
    env: environment,
    description:
      'CloudWatch Logs archival through Amazon Data Firehose into encrypted S3 storage'
  }
);

archiveStack.addDependency(databaseStack);
archiveStack.addDependency(applicationStack);
archiveStack.addDependency(webStack);


// ==========================================
// PHASE 19: EVENTBRIDGE AND LAMBDA REMEDIATION
// ==========================================

const remediationStack = new RemediationStack(
  app,
  'ObservabilityRemediationStack',
  {
    env: environment,

    cluster: applicationStack.cluster,

    service: applicationStack.service,

    description:
      'EventBridge-triggered Lambda remediation for centralized observability'
  }
);

remediationStack.addDependency(applicationStack);
