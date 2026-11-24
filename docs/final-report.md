# Centralized Observability Platform
## Final Technical Report

### 1. Project Overview

This project implements a centralized monitoring, logging, tracing, alerting, and automated response platform for a multi-tier application hosted on AWS.

The objective was to improve operational visibility, detect infrastructure and application failures, notify administrators, and automatically respond to selected incidents.

The solution was deployed in AWS Region `us-east-1` using AWS CDK and a combination of managed AWS services.

### 2. Observability Architecture and Design

The application uses a multi-tier architecture consisting of:

- **Web tier:** Nginx hosted on EC2 instances and exposed through an Application Load Balancer.
- **Application tier:** A containerized application running on Amazon ECS Fargate.
- **Database tier:** Amazon RDS for MySQL 8.4.11, deployed in private isolated subnets.
- **Container registry:** Amazon ECR stores application container images.
- **Monitoring:** Amazon CloudWatch collects infrastructure metrics, custom application metrics, logs, and alarm states.
- **Tracing:** OpenTelemetry and AWS X-Ray provide distributed tracing capabilities.
- **Log archiving:** Amazon S3 provides centralized log archival.
- **Automation:** Amazon EventBridge detects CloudWatch alarm state changes and invokes a remediation Lambda function.
- **Notifications:** Amazon SNS delivers operational notifications by email.

Infrastructure resources were provisioned using AWS CDK to support repeatability and infrastructure-as-code practices.

### 3. Metrics and Centralized Logging

CloudWatch collects standard infrastructure metrics:

| Component | Metrics |
|---|---|
| EC2 | CPU, memory, and disk utilization through CloudWatch Agent |
| ECS Fargate | CPU and memory utilization |
| Application Load Balancer | Request count and HTTP 5xx responses |
| RDS MySQL | CPU utilization, database connections, and free storage |
| Lambda | Invocations, errors, and execution duration |

The application also publishes custom metrics using CloudWatch Embedded Metric Format (EMF).

The custom metric namespace is `CentralizedObservability`, with `ErrorCount` published using the `Service` and `Environment` dimensions.

CloudWatch metric filters extract application errors, database errors, and HTTP 5xx responses from application logs.

Centralized log groups include:

- `/ec2/observability-web`
- `/ecs/observability-api`
- `/aws/rds/instance/observability-mysql/error`
- `/aws/rds/instance/observability-mysql/general`
- `/aws/rds/instance/observability-mysql/slowquery`
- `/aws/lambda/observability-alarm-remediation`

The configured retention period for the principal application, web, and database log groups is 30 days.

### 4. CloudWatch Logs Insights

Five Logs Insights queries were created and saved to analyze application errors, database errors, HTTP 5xx responses, error summaries, and remediation events.

An example query for application and database errors is:

```sql
fields @timestamp, event_type, error_type, message
| filter event_type in ["application_error", "database_error"]
| sort @timestamp desc
| limit 50
```

This query helps operators identify recent application and database failures, their timestamps, and associated error details.

### 5. Alarms and Automated Remediation

CloudWatch alarms monitor critical infrastructure and application conditions.

Important alarms include:

- `Observability-ECS-HighCPU`
- `Observability-ALB-HTTP5xx`
- `Observability-ApplicationErrorCount`
- `Observability-ApplicationErrors`
- `Observability-DatabaseErrors`
- `Observability-Http5xxErrors`

The EventBridge rule `observability-alarm-state-change` listens for CloudWatch alarm state changes and invokes the `observability-alarm-remediation` Lambda function.

The Lambda function implements bounded ECS scale-out:

1. It identifies the alarm that triggered the event.
2. For ECS high CPU, it checks the ECS service's desired task count.
3. If the desired count is below three, it requests scale-out to three tasks.
4. If the service is already at three tasks, it reports that maximum capacity has been reached.
5. For other alarms, it records the incident and publishes an SNS notification.
6. When an alarm recovers, it publishes a recovery notification without automatically scaling down the ECS service.

SNS notifications include the alarm name, event type, timestamp, and incident details.

### 6. Testing and Results

Controlled failure scenarios were executed to verify monitoring and automated response.

| Test | Result |
|---|---|
| Six simulated application failures | Application error alarm triggered |
| Two simulated database failures | Database error alarm triggered |
| Eight HTTP 5xx responses | HTTP 5xx alarm triggered |
| ECS scale-out from two to three tasks | Successful |
| ECS maximum-capacity condition | Correctly detected and reported |
| Alarm recovery | Recovery notifications published |
| SNS email delivery | Confirmed |

During the application and database failure tests, the corresponding alarms entered the ALARM state. Lambda logs confirmed incident processing and SNS notification publication.

The ECS scale-out test successfully increased the desired task count from two to three, with all three tasks running.

A separate controlled alarm-state test verified that the remediation function correctly handles the maximum-capacity condition.

Recovery tests confirmed that notifications were sent when alarms returned to OK.

### 7. Lessons Learned and Future Improvements

The project demonstrated the importance of combining infrastructure metrics, structured application logs, custom metrics, distributed tracing, and automated alerting.

Key lessons include:

- Structured JSON logging makes application incidents easier to investigate.
- Custom metrics provide application-level visibility beyond standard AWS metrics.
- Alarm thresholds should be based on normal application behavior to reduce false positives.
- Automated remediation must have explicit limits to prevent uncontrolled scaling.
- Recovery notifications improve operational awareness.
- Dashboards should present infrastructure and application health in one location.

Future improvements include implementing production-grade ECS scaling policies, expanding multi-AZ database resilience, refining alarm thresholds, and integrating automated deployment pipelines with monitoring validation.

### 8. Conclusion

The project successfully established centralized observability for a multi-tier AWS application.

CloudWatch monitoring, centralized logging, Logs Insights, distributed tracing, EventBridge, Lambda remediation, SNS notifications, and a unified dashboard work together to improve incident detection and response.

The controlled tests demonstrated that the platform can detect application and infrastructure failures, notify operators, scale ECS within defined limits, and report recovery events.
