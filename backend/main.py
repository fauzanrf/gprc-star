"""
main.py — FastAPI Application Entry Point
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import auth, accounts, kits, scrape, dashboard, parent_accounts, whatsapp

app = FastAPI(
    title="Starlink GPRC Dashboard API",
    description="API untuk monitoring dan kontrol akun Starlink",
    version="2.0.0",
)

# CORS — allow frontend origin
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost,http://localhost:80,http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(parent_accounts.router)
app.include_router(accounts.router)
app.include_router(kits.router)
app.include_router(scrape.router)
app.include_router(dashboard.router)
app.include_router(whatsapp.router)


@app.on_event("startup")
async def startup():
    """Init DB tables on startup."""
    import subprocess, sys
    subprocess.run([sys.executable, "init_db.py"], check=False)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "starlink-gprc-api"}


@app.get("/")
def root():
    return {"message": "Starlink GPRC Dashboard API — /docs untuk Swagger UI"}
