"""Scrape trigger & WebSocket live log."""
import asyncio
import json
from typing import Optional
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ScrapeJob
from schemas import ScrapeJobOut, StartScrapeRequest
from services.scraper_service import ScrapeManager

router  = APIRouter(prefix="/api/scrape", tags=["scrape"])
manager = ScrapeManager()


@router.post("/start", response_model=ScrapeJobOut)
async def start_scrape(req: StartScrapeRequest, db: Session = Depends(get_db)):
    """Mulai parallel scraping. Hanya boleh satu job berjalan sekaligus."""
    running = db.query(ScrapeJob).filter(ScrapeJob.status == "running").first()
    if running:
        raise HTTPException(status_code=409, detail=f"Job #{running.id} sedang berjalan.")

    job = ScrapeJob(status="pending", workers=req.workers or 3)
    db.add(job)
    db.commit()
    db.refresh(job)

    asyncio.create_task(manager.run_job(job.id, req.workers, parent_account_id=req.parent_account_id))
    return job


@router.post("/cancel")
async def cancel_scrape(db: Session = Depends(get_db)):
    """Batalkan proses scraping manual yang sedang berjalan."""
    success, msg = await manager.cancel_current_job()
    if not success:
        # Jika tidak ada process di memory, cek apakah ada job running di DB dan tandai failed
        running = db.query(ScrapeJob).filter(ScrapeJob.status == "running").first()
        if running:
            running.status = "failed"
            running.log = (running.log or "") + "\n[CANCELLED] Scraping dibatalkan secara paksa."
            db.commit()
            return {"message": f"Job #{running.id} ditandai batal di database."}
        raise HTTPException(status_code=400, detail=msg)
    return {"message": msg}


@router.get("/status", response_model=Optional[ScrapeJobOut])
def scrape_status(db: Session = Depends(get_db)):
    """Status job scraping terkini (running atau terakhir selesai)."""
    job = (
        db.query(ScrapeJob)
        .order_by(ScrapeJob.started_at.desc())
        .first()
    )
    return job


@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db)):
    """Riwayat semua scraping job."""
    jobs = db.query(ScrapeJob).order_by(ScrapeJob.started_at.desc()).limit(20).all()
    return [ScrapeJobOut.from_orm(j) for j in jobs]


@router.websocket("/ws")
async def scrape_ws(websocket: WebSocket):
    """WebSocket untuk live log scraping."""
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue()
    manager.subscribe(queue)
    try:
        while True:
            msg = await queue.get()
            await websocket.send_text(msg)
    except WebSocketDisconnect:
        pass
    finally:
        manager.unsubscribe(queue)
