import os
import logging

from opentelemetry import trace

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter
)

from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor


logger = logging.getLogger(__name__)


def configure_telemetry(app, engine):

    service_name = os.getenv(
        "OTEL_SERVICE_NAME",
        "centralized-observability-api"
    )

    environment = os.getenv(
        "APP_ENV",
        "development"
    )

    resource = Resource.create({
        "service.name": service_name,
        "deployment.environment": environment
    })

    provider = TracerProvider(resource=resource)

    exporter_type = os.getenv(
        "OTEL_TRACES_EXPORTER",
        "none"
    ).lower()

    if exporter_type == "otlp":

        endpoint = os.getenv(
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "http://localhost:4318"
        )

        exporter = OTLPSpanExporter(
            endpoint=f"{endpoint.rstrip('/')}/v1/traces"
        )

        provider.add_span_processor(
            BatchSpanProcessor(exporter)
        )

        logger.info(
            "OpenTelemetry OTLP trace exporting enabled"
        )

    elif exporter_type == "none":

        logger.info(
            "OpenTelemetry instrumentation enabled; "
            "trace exporting disabled"
        )

    else:

        logger.warning(
            "Unsupported OTEL_TRACES_EXPORTER value: %s",
            exporter_type
        )

    trace.set_tracer_provider(provider)

    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=provider
    )

    SQLAlchemyInstrumentor().instrument(
        engine=engine
    )

    LoggingInstrumentor().instrument(
        set_logging_format=False
    )

    logger.info(
        "OpenTelemetry instrumentation initialized"
    )
