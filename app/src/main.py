import os
import time
import logging
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Request,
    status
)

from sqlalchemy.orm import Session
from sqlalchemy import text

from .database import (
    engine,
    Base,
    get_db,
    check_database_connection
)

from .models import Item

from .schemas import (
    ItemCreate,
    ItemResponse
)

from .logging_config import configure_logging

from .metrics import record_error

from .telemetry import configure_telemetry


configure_logging()

logger = logging.getLogger(
    "centralized-observability-api"
)


APP_NAME = os.getenv(
    "APP_NAME",
    "centralized-observability-api"
)

APP_ENV = os.getenv(
    "APP_ENV",
    "development"
)


@asynccontextmanager
async def lifespan(app: FastAPI):

    logger.info(
        "Application startup initiated",
        extra={
            "event_type": "application_startup",
            "service": APP_NAME,
            "environment": APP_ENV
        }
    )

    # Wait for the database to become available.
    database_ready = False

    for attempt in range(1, 11):

        if check_database_connection():
            database_ready = True
            break

        logger.warning(
            "Waiting for database connection",
            extra={
                "event_type": "database_connection_retry",
                "attempt": attempt
            }
        )

        time.sleep(3)

    if not database_ready:

        logger.critical(
            "Database unavailable during startup"
        )

        raise RuntimeError(
            "Unable to establish database connection"
        )

    Base.metadata.create_all(
        bind=engine
    )

    logger.info(
        "Database initialization completed"
    )

    yield

    logger.info(
        "Application shutdown initiated"
    )

    engine.dispose()


app = FastAPI(
    title="Centralized Observability API",
    description=(
        "FastAPI application for centralized "
        "monitoring, logging and automated response."
    ),
    version="1.0.0",
    lifespan=lifespan
)


configure_telemetry(
    app,
    engine
)


@app.middleware("http")
async def request_logging_middleware(
    request: Request,
    call_next
):

    start_time = time.perf_counter()

    try:

        response = await call_next(request)

        duration = round(
            (time.perf_counter() - start_time) * 1000,
            2
        )

        logger.info(
            "HTTP request completed",
            extra={
                "event_type": "http_request",
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration
            }
        )

        return response

    except Exception:

        duration = round(
            (time.perf_counter() - start_time) * 1000,
            2
        )

        logger.exception(
            "Unhandled HTTP request exception",
            extra={
                "event_type": "http_exception",
                "method": request.method,
                "path": request.url.path,
                "duration_ms": duration
            }
        )

        record_error(
            "unhandled_exception"
        )

        raise


@app.get("/")
def root():

    return {
        "service": APP_NAME,
        "environment": APP_ENV,
        "status": "running",
        "message": "Centralized Observability Platform"
    }


# --------------------------------------------------
# HEALTH CHECK ENDPOINTS
# --------------------------------------------------

@app.get("/health/live")
def liveness_check():

    return {
        "status": "alive",
        "service": APP_NAME
    }


@app.get("/health/ready")
def readiness_check():

    database_status = check_database_connection()

    if not database_status:

        logger.error(
            "Application readiness check failed",
            extra={
                "event_type": "readiness_failure",
                "database": "unavailable"
            }
        )

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable"
        )

    return {
        "status": "ready",
        "database": "connected"
    }


@app.get("/health")
def health_check():

    return {
        "status": "healthy",
        "application": APP_NAME,
        "database": (
            "connected"
            if check_database_connection()
            else "disconnected"
        )
    }


# --------------------------------------------------
# DATABASE CRUD ENDPOINTS
# --------------------------------------------------

@app.post(
    "/items",
    response_model=ItemResponse,
    status_code=status.HTTP_201_CREATED
)
def create_item(
    item: ItemCreate,
    db: Session = Depends(get_db)
):

    try:

        db_item = Item(
            name=item.name,
            description=item.description
        )

        db.add(db_item)

        db.commit()

        db.refresh(db_item)

        logger.info(
            "Item created successfully",
            extra={
                "event_type": "item_created",
                "item_id": db_item.id
            }
        )

        return db_item

    except Exception:

        db.rollback()

        logger.exception(
            "Item creation failed"
        )

        record_error(
            "database_write_error"
        )

        raise HTTPException(
            status_code=500,
            detail="Unable to create item"
        )


@app.get(
    "/items",
    response_model=list[ItemResponse]
)
def get_items(
    db: Session = Depends(get_db)
):

    return db.query(Item).all()


@app.get(
    "/items/{item_id}",
    response_model=ItemResponse
)
def get_item(
    item_id: int,
    db: Session = Depends(get_db)
):

    item = db.query(Item).filter(
        Item.id == item_id
    ).first()

    if not item:

        raise HTTPException(
            status_code=404,
            detail="Item not found"
        )

    return item


# --------------------------------------------------
# ERROR SIMULATION ENDPOINTS
# --------------------------------------------------

@app.get("/simulate/error")
def simulate_error():

    logger.error(
        "Simulated application error",
        extra={
            "event_type": "application_error",
            "simulation": True
        }
    )

    record_error(
        "simulated_application_error"
    )

    raise HTTPException(
        status_code=500,
        detail="Simulated internal server error"
    )


@app.get("/simulate/errors/{count}")
def simulate_multiple_errors(count: int):

    if count < 1 or count > 100:

        raise HTTPException(
            status_code=400,
            detail="Count must be between 1 and 100"
        )

    for index in range(count):

        logger.error(
            "Simulated error event",
            extra={
                "event_type": "application_error",
                "simulation": True,
                "error_number": index + 1
            }
        )

        record_error(
            "simulated_application_error"
        )

    return {
        "message": "Errors generated",
        "count": count
    }


# --------------------------------------------------
# SLOW REQUEST SIMULATION
# --------------------------------------------------

@app.get("/simulate/slow")
def simulate_slow_request():

    logger.warning(
        "Slow request simulation started",
        extra={
            "event_type": "slow_request"
        }
    )

    time.sleep(5)

    logger.warning(
        "Slow request simulation completed",
        extra={
            "event_type": "slow_request"
        }
    )

    return {
        "message": "Slow request completed",
        "delay_seconds": 5
    }


# --------------------------------------------------
# DATABASE FAILURE SIMULATION
# --------------------------------------------------

@app.get("/simulate/database-error")
def simulate_database_error():

    try:

        with engine.connect() as connection:

            connection.execute(
                text(
                    "SELECT * FROM nonexistent_observability_table"
                )
            )

    except Exception:

        logger.exception(
            "Simulated database query failure",
            extra={
                "event_type": "database_error",
                "simulation": True
            }
        )

        record_error(
            "database_query_error"
        )

        raise HTTPException(
            status_code=500,
            detail="Simulated database failure"
        )

    return {
        "message": "Unexpected success"
    }


# --------------------------------------------------
# APPLICATION INFORMATION
# --------------------------------------------------

@app.get("/info")
def application_info():

    return {
        "application": APP_NAME,
        "environment": APP_ENV,
        "version": "1.0.0",
        "observability": {
            "json_logging": True,
            "opentelemetry": True,
            "custom_metrics": True,
            "database_monitoring": True
        }
    }
