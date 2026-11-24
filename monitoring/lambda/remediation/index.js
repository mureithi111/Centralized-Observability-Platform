'use strict';

const {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand
} = require('@aws-sdk/client-ecs');

const {
  SNSClient,
  PublishCommand
} = require('@aws-sdk/client-sns');

const region = process.env.AWS_REGION || 'us-east-1';

const ecs = new ECSClient({ region });
const sns = new SNSClient({ region });

const MAX_DESIRED_COUNT = 3;
const HIGH_CPU_ALARM = 'Observability-ECS-HighCPU';

const MONITORED_ALARMS = new Set([
  'Observability-ALB-HTTP5xx',
  'Observability-ApplicationErrorCount',
  'Observability-ApplicationErrors',
  'Observability-DatabaseErrors',
  'Observability-ECS-HighCPU',
  'Observability-Http5xxErrors'
]);

async function publishNotification(eventType, alarmName, message, details = {}) {
  const topicArn = process.env.SNS_TOPIC_ARN;

  if (!topicArn) {
    throw new Error('SNS_TOPIC_ARN environment variable is missing.');
  }

  const notification = {
    project: 'Centralized Observability Platform',
    eventType,
    alarmName,
    timestamp: new Date().toISOString(),
    message,
    details
  };

  await sns.send(new PublishCommand({
    TopicArn: topicArn,
    Subject: `[Observability] ${eventType}`.slice(0, 100),
    Message: JSON.stringify(notification, null, 2)
  }));

  console.log(JSON.stringify({
    event: 'SNS_NOTIFICATION_PUBLISHED',
    eventType,
    alarmName
  }));
}

exports.handler = async (event) => {
  console.log('Received CloudWatch alarm event:', JSON.stringify(event));

  const alarmName = event?.detail?.alarmName;
  const alarmState = event?.detail?.state?.value;

  if (!alarmName || !alarmState) {
    console.warn('Ignoring event: missing alarm name or state.');
    return { status: 'IGNORED', reason: 'Invalid alarm event' };
  }

  if (!MONITORED_ALARMS.has(alarmName)) {
    console.warn(`Ignoring unmonitored alarm: ${alarmName}`);
    return { status: 'IGNORED', alarmName };
  }

  // Notify operations when an alarm recovers.
  if (alarmState === 'OK') {
    console.log(JSON.stringify({
      event: 'ALARM_RECOVERY',
      alarmName,
      message: 'CloudWatch alarm returned to OK.'
    }));

    await publishNotification(
      'ALARM_RECOVERY',
      alarmName,
      'A monitored CloudWatch alarm has recovered.',
      { alarmState: 'OK' }
    );

    return { status: 'RECOVERED', alarmName };
  }

  if (alarmState !== 'ALARM') {
    console.log(`No action for state ${alarmState}: ${alarmName}`);
    return { status: 'NO_ACTION', alarmName, alarmState };
  }

  console.error(JSON.stringify({
    event: 'ALARM_TRIGGERED',
    alarmName,
    message: 'A monitored CloudWatch alarm entered ALARM state.'
  }));

  // Non-CPU alarms generate operational incident notifications.
  if (alarmName !== HIGH_CPU_ALARM) {
    await publishNotification(
      'ALARM_TRIGGERED',
      alarmName,
      'A monitored infrastructure or application incident was detected.',
      { alarmState: 'ALARM' }
    );

    return { status: 'INCIDENT_RECORDED', alarmName };
  }

  // ECS high CPU: perform bounded scale-out.
  const cluster = process.env.ECS_CLUSTER;
  const service = process.env.ECS_SERVICE;

  if (!cluster || !service) {
    throw new Error('ECS_CLUSTER or ECS_SERVICE environment variable is missing.');
  }

  const describeResult = await ecs.send(
    new DescribeServicesCommand({
      cluster,
      services: [service]
    })
  );

  const ecsService = describeResult.services?.[0];

  if (!ecsService || ecsService.status !== 'ACTIVE') {
    throw new Error(`ECS service ${service} was not found or is not ACTIVE.`);
  }

  const currentDesiredCount = ecsService.desiredCount;

  console.log(JSON.stringify({
    event: 'ECS_CAPACITY_CHECK',
    cluster,
    service,
    currentDesiredCount,
    maximumDesiredCount: MAX_DESIRED_COUNT
  }));

  // Notify operations if the configured maximum has been reached.
  if (currentDesiredCount >= MAX_DESIRED_COUNT) {
    await publishNotification(
      'ECS_MAXIMUM_CAPACITY_REACHED',
      alarmName,
      'ECS is already at its maximum configured desired task count. No additional scale-out was performed.',
      {
        cluster,
        service,
        currentDesiredCount,
        maximumDesiredCount: MAX_DESIRED_COUNT
      }
    );

    return {
      status: 'MAXIMUM_REACHED',
      currentDesiredCount,
      maximumDesiredCount: MAX_DESIRED_COUNT
    };
  }

  const updateResult = await ecs.send(
    new UpdateServiceCommand({
      cluster,
      service,
      desiredCount: MAX_DESIRED_COUNT
    })
  );

  const newDesiredCount = updateResult.service?.desiredCount;

  console.log(JSON.stringify({
    event: 'ECS_SCALE_OUT_REQUESTED',
    cluster,
    service,
    previousDesiredCount: currentDesiredCount,
    newDesiredCount,
    maximumDesiredCount: MAX_DESIRED_COUNT
  }));

  await publishNotification(
    'ECS_SCALE_OUT_REQUESTED',
    alarmName,
    'Automated remediation requested an ECS service scale-out.',
    {
      cluster,
      service,
      previousDesiredCount: currentDesiredCount,
      newDesiredCount,
      maximumDesiredCount: MAX_DESIRED_COUNT
    }
  );

  return {
    status: 'SCALE_OUT_REQUESTED',
    previousDesiredCount: currentDesiredCount,
    newDesiredCount
  };
};
