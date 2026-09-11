from magnet_forge_format import ProjectFile, dump_project_json, parse_project_json


def test_fixture_round_trips_through_validation_and_serialization(loaded_fixture: ProjectFile):
    serialized = dump_project_json(loaded_fixture)
    reparsed = parse_project_json(serialized)

    assert reparsed == loaded_fixture


def test_round_trip_is_stable_across_multiple_cycles(loaded_fixture: ProjectFile):
    once = parse_project_json(dump_project_json(loaded_fixture))
    twice = parse_project_json(dump_project_json(once))

    assert once == twice == loaded_fixture


def test_fixture_has_expected_shape(loaded_fixture: ProjectFile):
    assert loaded_fixture.schema_version == "1"
    assert len(loaded_fixture.palette) == 3
    assert len(loaded_fixture.regions) == 3
    assert any(region.holes for region in loaded_fixture.regions)
    assert len(loaded_fixture.pocket_settings.pockets) == 1
