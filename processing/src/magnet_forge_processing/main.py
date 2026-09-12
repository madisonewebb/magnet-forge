from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import fixture, health, uploads

app = FastAPI(title="Magnet Forge processing service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(fixture.router)
app.include_router(uploads.router)
