from fastapi.testclient import TestClient

from src.main import app


def test_root_endpoint():

    with TestClient(app) as client:

        response = client.get("/")

        assert response.status_code == 200

        assert response.json()["status"] == "running"


def test_liveness_endpoint():

    with TestClient(app) as client:

        response = client.get("/health/live")

        assert response.status_code == 200

        assert response.json()["status"] == "alive"


def test_application_info():

    with TestClient(app) as client:

        response = client.get("/info")

        assert response.status_code == 200

        data = response.json()

        assert data["observability"]["json_logging"] is True

        assert data["observability"]["opentelemetry"] is True


def test_error_simulation():

    with TestClient(app) as client:

        response = client.get("/simulate/error")

        assert response.status_code == 500


def test_slow_endpoint():

    with TestClient(app) as client:

        response = client.get("/simulate/slow")

        assert response.status_code == 200

        assert response.json()["delay_seconds"] == 5


def test_multiple_errors_validation():

    with TestClient(app) as client:

        response = client.get("/simulate/errors/101")

        assert response.status_code == 400
