import os
import logging
import sys

from pythonjsonlogger import jsonlogger


def configure_logging():

    log_level = os.getenv(
        "LOG_LEVEL",
        "INFO"
    ).upper()

    handler = logging.StreamHandler(
        sys.stdout
    )

    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={
            "asctime": "timestamp",
            "levelname": "level",
            "name": "logger"
        }
    )

    handler.setFormatter(formatter)

    root_logger = logging.getLogger()

    root_logger.handlers.clear()

    root_logger.addHandler(handler)

    root_logger.setLevel(log_level)

    logging.getLogger(
        "uvicorn.access"
    ).setLevel(logging.INFO)

    logging.getLogger(
        "sqlalchemy.engine"
    ).setLevel(logging.WARNING)
