import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import require_admin, require_staff
from ..models import User
from ..schemas import UserCreate, UserOut, UserUpdate
from ..security import hash_password

router = APIRouter(prefix="/admin/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(role: str | None = None, db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    q = select(User).order_by(User.created_at.desc())
    if role:
        q = q.where(User.role == role)
    return (await db.execute(q)).scalars().all()


@router.post("", response_model=UserOut)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    email = body.email.lower()
    exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "이미 존재하는 이메일입니다")
    user = User(email=email, name=body.name, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: uuid.UUID, body: UserUpdate, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if body.name is not None:
        user.name = body.name
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}")
async def delete_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(400, "자기 자신은 삭제할 수 없습니다")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    await db.delete(user)
    await db.commit()
    return {"ok": True}
