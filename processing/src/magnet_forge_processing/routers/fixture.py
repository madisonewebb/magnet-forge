from fastapi import APIRouter

from magnet_forge_format import ProjectFile

from ..fixture_source import load_fixture_project

router = APIRouter()


@router.get("/fixture", response_model=ProjectFile, response_model_by_alias=True)
def get_fixture() -> ProjectFile:
    return load_fixture_project()
