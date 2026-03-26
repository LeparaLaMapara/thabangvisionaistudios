// ─── Creator Portfolio Types ─────────────────────────────────────────────────

export interface PortfolioPhoto {
  url: string;
  public_id: string;
}

export interface PortfolioVideo {
  url: string;
  public_id: string;
}

export interface PortfolioProject {
  id: string;
  title: string;
  project_type: string;
  photos: PortfolioPhoto[];
  video: PortfolioVideo | null;
}
