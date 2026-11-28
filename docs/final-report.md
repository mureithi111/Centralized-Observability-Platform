# Observability-as-a-Service: Centralized Monitoring, Logging, and Automated Response for a Multi-Tier Application

## Final Technical Report

### 1. Project Overview

This project implemented a centralized monitoring, logging, tracing, alerting, and automated response platform for a multi-tier application hosted on Amazon Web Services (AWS).

The primary objective was to improve operational visibility, detect infrastructure and application failures, notify administrators, and automatically respond to selected incidents.

The solution was implemented in AWS Region `us-east-1`, using AWS Cloud Development Kit (CDK), containerized application services, and managed AWS services.

The project demonstrated how observability components can work together to provide a centralized operational view of an application and its supporting infrastructure.

**Project status:** The infrastructure was deployed and tested. AWS resources were subsequently deleted to avoid continued infrastructure costs. The source code, infrastructure definitions, documentation, and available evidence remain in the local project repository.

### 2. Observability Architecture and Design

The solution uses a multi-tier application architecture.

| Layer | Technology | Responsibility |
|---|---|---|
| Entry point | Application Load Balancer | Receives incoming application traffic |
| Web tier | Amazon EC2 and Nginx | Handles web traffic and proxies application requests |
| Application tier | Amazon ECS Fargate and FastAPI | Runs the application API |
| Telemetry collection | AWS Distro for OpenTelemetry (ADOT) | Collects and exports application traces |
| Database tier | Amazon RDS for MySQL 8.4.11 | Stores application data |
| Container registry | Amazon ECR | Stores application and collector images |
| Monitoring | Amazon CloudWatch | Collects metrics, logs, and alarm states |
| Tracing | OpenTelemetry and AWS X-Ray | Provides the configured distributed tracing pipeline |
| Log archival | Amazon Data Firehose and Amazon S3 | Delivers log archives to object storage |
| Event processing | Amazon EventBridge | Routes CloudWatch alarm state-change events |
| Automated response | AWS Lambda | Processes incidents and performs bounded ECS remediation |
| Notifications | Amazon SNS | Delivers operational notifications |

The infrastructure was organized into separate CDK stacks for networking, database, container registry, application, web, archival, and remediation components.

The approved architecture diagram is included as the visual reference for the project.

### 3. Metrics and Centralized Logging

Amazon CloudWatch was used to monitor infrastructure and application behavior.

The monitored infrastructure metrics included:

| Component | Metrics |
|---|---|
| EC2 | CPU, memory, and disk utilization through CloudWatch Agent |
| ECS Fargate | CPU and memory utilization |
| Application Load Balancer | Request count and HTTP 5xx responses |
| RDS MySQL | CPU utilization, database connections, and free storage |
| Lambda | Invocations, errors, and execution duration |

The application also published custom metrics using CloudWatch Embedded Metric Format (EMF).

The custom metric configuration used:

- Namespace: `CentralizedObservability`
- Metric: `ErrorCount`
- Dimensions: `Service` and `Environment`
- Metric value: `1` for each recorded error event

Structured JSON logging was implemented using `python-json-logger`.

This allowed application log events to include timestamps, severity levels, logger names, and message details.

The principal log groups included:

- `/ec2/observability-web`
- `/ecs/observability-api`
- `/aws/rds/instance/observability-mysql/error`
- `/aws/rds/instance/observability-mysql/general`
- `/aws/rds/instance/observability-mysql/slowquery`
- `/aws/lambda/observability-alarm-remediation`

The principal application, web, and database log groups were configured with a 30-day retention period.

CloudWatch Logs Insights queries were created for application errors, database errors, HTTP 5xx responses, error summaries, and remediation events.

### 4. CloudWatch Logs Insights

Five Logs Insights queries were prepared to support operational investigation.

An example query used to identify application and database failures was:

```sql
fields @timestamp, event_type, error_type, message
| filter event_type in ["application_error", "database_error"]
| sort @timestamp desc
| limit 50
```

The queries provided a way to investigate recent failures, identify event timestamps, and inspect associated error information.

### 5. Alarms and Automated Remediation

The monitoring solution included six important alarm definitions:

- `Observability-ECS-HighCPU`
- `Observability-ALB-HTTP5xx`
- `Observability-ApplicationErrorCount`
- `Observability-ApplicationErrors`
- `Observability-DatabaseErrors`
- `Observability-Http5xxErrors`

The EventBridge rule `observability-alarm-state-change` was configured to process CloudWatch alarm state changes.

The rule invoked the Lambda function `observability-alarm-remediation`.

The remediation function implemented bounded ECS scale-out:

1. It identified the alarm associated with the incoming event.
2. For an ECS high-CPU alarm, it inspected the ECS service's desired task count.
3. If the desired count was below three, it requested an increase to three tasks.
4. If the service was already at three tasks, it reported that maximum capacity had been reached.
5. For other monitored alarms, it processed the incident and published an SNS notification.
6. When an alarm recovered, it published a recovery notification without automatically scaling down the ECS service.

The notifications included information about the alarm, event type, timestamp, and incident details.

#### Infrastructure-as-Code Review Finding

During the project review, an important limitation was identified.

Although the infrastructure was organized into CDK stacks, not every monitoring component was represented as a project-level CDK resource definition.

Specifically:

- Some CloudWatch alarm and metric-filter resources were created outside the corresponding CDK stack definitions.
- The remediation stack imported the SNS topic using a hardcoded ARN instead of creating and managing the topic through CDK.
- This meant the infrastructure code did not fully describe the deployed monitoring and notification architecture.

This reduced the completeness and portability of the infrastructure definitions.

The finding established a clear improvement for a future implementation: manage the alarms, metric filters, and SNS topic through CDK and connect resources using construct references rather than account-specific hardcoded ARNs.

### 6. Distributed Tracing with OpenTelemetry and AWS X-Ray

The application was configured to use an ADOT Collector sidecar alongside the FastAPI container.

The tracing configuration included:

- OTLP receivers using gRPC and HTTP.
- An OTLP HTTP exporter targeting the AWS X-Ray trace ingestion endpoint.
- AWS SigV4 authentication for the X-Ray exporter.
- ECS task-role permissions for `xray:PutTraceSegments` and `xray:PutTelemetryRecords`.
- An OpenTelemetry service name of `centralized-observability-api`.

The collector was configured to receive traces from the application and forward them to AWS X-Ray.

**Evidence limitation:** The project retained configuration evidence for the tracing pipeline, but no screenshot or independent verification of successfully ingested X-Ray traces was captured.

Therefore, the tracing integration should be described as configured, not as independently proven operational.

A future implementation should include an end-to-end trace test, verification of received traces in the X-Ray console, and screenshots showing trace data and service relationships.

### 7. Testing and Results

Controlled failure scenarios were executed to validate monitoring, alerting, and automated remediation.

| Test | Recorded result |
|---|---|
| Six simulated application failures | Application error alarm triggered |
| Two simulated database failures | Database error alarm triggered |
| Eight HTTP 5xx responses | HTTP 5xx alarm triggered |
| ECS scale-out from two to three tasks | Successful |
| ECS maximum-capacity condition | Correctly detected and reported |
| Alarm recovery | Recovery notifications published |
| SNS email delivery | Confirmed |

During the application and database failure tests, the corresponding alarms entered the ALARM state.

Lambda logs recorded incident-processing events, notification publication, and recovery handling.

The ECS scale-out test increased the desired task count from two to three, with three tasks running.

A separate controlled alarm-state test verified that the remediation function handled the maximum-capacity condition.

Recovery tests confirmed that notifications were published when alarms returned to the OK state.

These results represent the historical tests performed while the AWS infrastructure was deployed. They are not claims that the resources remain active.

### 8. Implementation Challenges and Resolutions

Several practical engineering challenges were encountered during implementation.

#### 8.1 Firehose Delivery Permission Failure

**Problem:** Initial log archival delivery through Amazon Data Firehose failed because the delivery role lacked the required `firehose:PutRecord` permission.

**Resolution:** The missing IAM permission was added, and subsequent delivery was verified.

**Lesson:** When integrating AWS managed services, verify the complete IAM permission chain between the source, delivery service, and destination. A correctly configured destination does not guarantee successful delivery if the service role lacks permission.

#### 8.2 Invalid RDS Parameter Group Family

**Problem:** The initial MySQL parameter-group family configuration did not match the supported engine family.

**Resolution:** The configuration was corrected using:

```typescript
MysqlEngineVersion.of('8.4.11', '8.4')
```

The parameter group subsequently reached the `in-sync` state.

**Lesson:** Database engine versions and parameter-group families must be compatible. Validate engine-specific configuration before deployment.

#### 8.3 ECS Task Resource Allocation

**Problem:** The ECS task needed sufficient capacity to run both the FastAPI application and the ADOT Collector sidecar.

**Resolution:** The task definition was adjusted to 1024 CPU units and 2048 MiB of memory, with resources allocated to the application and collector containers.

**Lesson:** Sidecars consume task resources too. Container resource allocation must consider the combined workload rather than sizing only the main application container.

#### 8.4 Lambda Reserved Concurrency Conflict

**Problem:** A reserved-concurrency configuration conflicted with the account's available unreserved Lambda concurrency.

**Resolution:** The conflicting reserved-concurrency configuration was removed.

**Lesson:** Account-level service quotas must be considered when configuring concurrency restrictions. A function-level configuration can affect the ability to deploy or run other functions in the same account.

#### 8.5 Local Database Connectivity During Testing

**Problem:** Host-run pytest execution initially encountered a database connection issue because the Docker Compose hostname was not resolvable from the host machine.

**Resolution:** The test environment was configured to use `127.0.0.1` and port `3307` when running tests from the host. Docker Compose continued using the internal hostname `mysql` and port `3306`.

The application tests subsequently passed 6/6.

**Lesson:** Docker container networking and host networking use different connection addresses. Test configurations must reflect where the application or test process is running.

#### 8.6 Cross-Stack Infrastructure Dependencies

**Problem:** Resources were distributed across multiple CDK stacks, creating dependencies between networking, database, application, web, archival, and remediation components.

**Resolution:** Explicit stack dependencies and cross-stack references were used to coordinate resource relationships.

**Lesson:** Stack boundaries should reflect architectural responsibilities, and dependencies should be explicit. This makes infrastructure relationships easier to understand and reduces deployment-order problems.

#### 8.7 X-Ray Evidence Gap

**Problem:** The ADOT collector, X-Ray exporter, and IAM permissions were configured, but the project did not capture independent evidence of successfully received traces.

**Resolution:** The limitation was identified during the project review and recorded rather than presenting configuration as proof of successful trace ingestion.

**Lesson:** Observability integrations require end-to-end validation. A configured exporter and valid permissions do not, by themselves, demonstrate that telemetry reached its destination.

### 9. Lessons Learned and Future Improvements

The implementation demonstrated several practical lessons:

- IAM permissions must be validated across complete service integrations, not just individual resources.
- Managed database configuration must match the exact engine version and supported parameter-group family.
- Container sidecars must be included when calculating task CPU and memory requirements.
- Account-level service quotas can affect infrastructure deployment and runtime configuration.
- Local testing must account for differences between container and host networking.
- Infrastructure dependencies should be represented clearly in CDK.
- Observability integrations need actual telemetry validation and supporting evidence.
- Infrastructure-as-Code should describe all important resources, including alarms, metric filters, and notification topics.

Future improvements include:

1. Complete CDK coverage for CloudWatch alarms, metric filters, and SNS resources.
2. Replace hardcoded resource ARNs with CDK construct references.
3. Capture verified AWS X-Ray trace evidence.
4. Implement production-grade ECS scaling policies.
5. Improve multi-AZ database resilience.
6. Refine alarm thresholds using normal workload baselines.
7. Integrate monitoring validation into automated deployment pipelines.
8. Introduce repeatable end-to-end failure and recovery tests.

### 10. Conclusion

The project demonstrated how centralized observability can be implemented for a multi-tier application using AWS managed services.

The solution brought together infrastructure monitoring, structured application logging, custom metrics, Logs Insights, OpenTelemetry configuration, automated incident processing, bounded ECS remediation, SNS notifications, and centralized log archival.

Controlled tests demonstrated application and database failure detection, HTTP error monitoring, ECS scale-out, maximum-capacity handling, and recovery notifications.

The implementation also exposed practical challenges involving IAM permissions, database configuration, container resource allocation, Lambda concurrency, networking, infrastructure dependencies, and observability evidence.

The project review identified further improvements in infrastructure-as-code completeness and X-Ray verification.

Although the AWS resources were deleted after testing to avoid ongoing costs, the implementation, testing experience, infrastructure definitions, and lessons learned provide a foundation for future improvements to the platform.