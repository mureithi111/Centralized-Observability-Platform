import * as cdk from 'aws-cdk-lib';

import {
  Construct
} from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class NetworkStack extends cdk.Stack {

  public readonly vpc: ec2.Vpc;

  public readonly albSecurityGroup: ec2.SecurityGroup;

  public readonly webSecurityGroup: ec2.SecurityGroup;

  public readonly appSecurityGroup: ec2.SecurityGroup;

  public readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    props?: cdk.StackProps
  ) {

    super(scope, id, props);

    // ==========================================
    // VPC CONFIGURATION
    // ==========================================

    this.vpc = new ec2.Vpc(
      this,
      'ObservabilityVpc',
      {
        vpcName: 'observability-vpc',

        ipAddresses: ec2.IpAddresses.cidr(
          '10.30.0.0/16'
        ),

        maxAzs: 2,

        natGateways: 1,

        enableDnsSupport: true,

        enableDnsHostnames: true,

        restrictDefaultSecurityGroup: true,

        subnetConfiguration: [

          {
            name: 'public',

            subnetType: ec2.SubnetType.PUBLIC,

            cidrMask: 20,

            mapPublicIpOnLaunch: true
          },

          {
            name: 'web',

            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,

            cidrMask: 20
          },

          {
            name: 'app',

            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,

            cidrMask: 20
          },

          {
            name: 'database',

            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,

            cidrMask: 20
          }

        ]
      }
    );

    // ==========================================
    // SECURITY GROUPS
    // ==========================================

    this.albSecurityGroup = new ec2.SecurityGroup(
      this,
      'ObservabilityAlbSecurityGroup',
      {
        vpc: this.vpc,

        securityGroupName: 'observability-alb-sg',

        description: 'Internet-facing ALB security group',

        allowAllOutbound: false
      }
    );

    this.webSecurityGroup = new ec2.SecurityGroup(
      this,
      'ObservabilityWebSecurityGroup',
      {
        vpc: this.vpc,

        securityGroupName: 'observability-web-sg',

        description: 'EC2 web tier security group',

        allowAllOutbound: false
      }
    );

    this.appSecurityGroup = new ec2.SecurityGroup(
      this,
      'ObservabilityAppSecurityGroup',
      {
        vpc: this.vpc,

        securityGroupName: 'observability-app-sg',

        description: 'ECS application tier security group',

        allowAllOutbound: false
      }
    );

    this.dbSecurityGroup = new ec2.SecurityGroup(
      this,
      'ObservabilityDatabaseSecurityGroup',
      {
        vpc: this.vpc,

        securityGroupName: 'observability-db-sg',

        description: 'RDS MySQL security group',

        allowAllOutbound: false
      }
    );

    // ==========================================
    // ALB SECURITY RULES
    // ==========================================

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic'
    );

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic'
    );

    this.albSecurityGroup.addEgressRule(
      this.webSecurityGroup,
      ec2.Port.tcp(80),
      'Forward HTTP traffic to web tier'
    );

    // ==========================================
    // WEB SECURITY RULES
    // ==========================================

    this.webSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(80),
      'Allow traffic from ALB'
    );

    this.webSecurityGroup.addEgressRule(
      this.appSecurityGroup,
      ec2.Port.tcp(8000),
      'Forward traffic to FastAPI application'
    );

    this.webSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS for SSM and AWS services'
    );

    // ==========================================
    // APPLICATION SECURITY RULES
    // ==========================================

    this.appSecurityGroup.addIngressRule(
      this.webSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow FastAPI traffic from web tier'
    );

    this.appSecurityGroup.addEgressRule(
      this.dbSecurityGroup,
      ec2.Port.tcp(3306),
      'Allow MySQL connections'
    );

    this.appSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS for AWS APIs and telemetry'
    );

    // ==========================================
    // DATABASE SECURITY RULES
    // ==========================================

    this.dbSecurityGroup.addIngressRule(
      this.appSecurityGroup,
      ec2.Port.tcp(3306),
      'Allow MySQL from ECS application tier'
    );

    // ==========================================
    // CLOUDFORMATION OUTPUTS
    // ==========================================

    new cdk.CfnOutput(
      this,
      'ObservabilityVpcId',
      {
        value: this.vpc.vpcId,

        description: 'Observability VPC ID'
      }
    );

    new cdk.CfnOutput(
      this,
      'ObservabilityVpcCidr',
      {
        value: '10.30.0.0/16'
      }
    );

    new cdk.CfnOutput(
      this,
      'AvailabilityZones',
      {
        value: cdk.Fn.join(
          ',',
          this.vpc.availabilityZones
        )
      }
    );

    new cdk.CfnOutput(
      this,
      'PublicSubnetIds',
      {
        value: cdk.Fn.join(
          ',',
          this.vpc.selectSubnets({
            subnetGroupName: 'public'
          }).subnetIds
        )
      }
    );

    new cdk.CfnOutput(
      this,
      'WebSubnetIds',
      {
        value: cdk.Fn.join(
          ',',
          this.vpc.selectSubnets({
            subnetGroupName: 'web'
          }).subnetIds
        )
      }
    );

    new cdk.CfnOutput(
      this,
      'AppSubnetIds',
      {
        value: cdk.Fn.join(
          ',',
          this.vpc.selectSubnets({
            subnetGroupName: 'app'
          }).subnetIds
        )
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabaseSubnetIds',
      {
        value: cdk.Fn.join(
          ',',
          this.vpc.selectSubnets({
            subnetGroupName: 'database'
          }).subnetIds
        )
      }
    );

    new cdk.CfnOutput(
      this,
      'AlbSecurityGroupId',
      {
        value: this.albSecurityGroup.securityGroupId
      }
    );

    new cdk.CfnOutput(
      this,
      'WebSecurityGroupId',
      {
        value: this.webSecurityGroup.securityGroupId
      }
    );

    new cdk.CfnOutput(
      this,
      'AppSecurityGroupId',
      {
        value: this.appSecurityGroup.securityGroupId
      }
    );

    new cdk.CfnOutput(
      this,
      'DatabaseSecurityGroupId',
      {
        value: this.dbSecurityGroup.securityGroupId
      }
    );

    // ==========================================
    // RESOURCE TAGGING
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

  }

}
