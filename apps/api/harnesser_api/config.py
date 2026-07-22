from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://harnesser:harnesser@localhost:5432/harnesser"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "harnesser-dev-secret-change-me"
    jwt_expire_hours: int = 12
    internal_token: str = "harnesser-internal-change-me"

    seed_demo_data: bool = True

    ai_base_url: str = "https://api.openai.com/v1"
    ai_api_key: str = ""
    ai_chat_model: str = "gpt-4o-mini"
    ai_eval_model: str = "gpt-4o-mini"

    # 응시 제한
    max_code_bytes: int = 128 * 1024
    max_event_batch: int = 50
    ai_history_limit: int = 40

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
