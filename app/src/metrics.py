import json
import logging
import os
import time

logger = logging.getLogger("application.metrics")

SERVICE_NAME = os.getenv(
    "APP_NAME",
    "centralized-observability-api"
)

ENVIRONMENT = os.getenv(
    "APP_ENV",
    "development"
)


def record_error(error_type: str):

    timestamp = int(time.time() * 1000)

    metric_event = {
        "_aws": {
            "Timestamp": timestamp,
            "CloudWatchMetrics": [
                {
                    "Namespace": "CentralizedObservability",
                    "Dimensions": [
                        [
                            "Service",
                            "Environment"
                        ]
                    ],
                    "Metrics": [
                        {
                            "Name": "ErrorCount",
                            "Unit": "Count"
                        }
                    ]
                }
            ]
        },
        "Service": SERVICE_NAME,
        "Environment": ENVIRONMENT,
        "ErrorType": error_type,
        "ErrorCount": 1
    }

    print(
        json.dumps(metric_event),
        flush=True
    )
