from fastapi.testclient import TestClient

from magnet_forge_format import ProjectFile
from magnet_forge_processing.main import app

client = TestClient(app)


def test_fixture_endpoint_returns_valid_project():
    response = client.get("/fixture")

    assert response.status_code == 200
    body = response.json()
    assert body["schemaVersion"] == "1"

    # Round-trips through the same validation the format package itself
    # uses, proving the boundary validation is real and not just a shape
    # check on this one field.
    ProjectFile.model_validate(body)
