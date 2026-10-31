from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "FairSprint AI"
    log_level: str = "INFO"
    # Comma-separated origins allowed to call the API (React + Vite dev server by default).
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    github_token: str = ""
    github_repo_owner: str = ""
    github_repo_name: str = ""
    gemini_api_key: str = ""
    openai_api_key: str = ""

    # LLM providers: Gemini primary, Groq fallback
    gemini_model: str = "gemini-2.5-flash"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    agent_max_iterations: int = 5
    agent_timeout_seconds: int = 60

    # POST /teams/{id}/seed is disabled unless this is set; callers send it as `X-Admin-Token`.
    seed_admin_token: str = ""
    # Optional override; by default the synthetic dataset ZIP is looked up in the project root.
    seed_zip_path: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
