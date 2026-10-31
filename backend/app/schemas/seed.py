from pydantic import BaseModel, Field


class TableSeedResult(BaseModel):
    table: str
    inserted: int = 0
    updated: int = 0
    failed: int = 0
    errors: list[str] = Field(default_factory=list)


class SeedResponse(BaseModel):
    team_id: str
    source_label: str = "synthetic"
    dry_run: bool = False
    inserted: int
    updated: int
    failed: int
    tables: list[TableSeedResult]
