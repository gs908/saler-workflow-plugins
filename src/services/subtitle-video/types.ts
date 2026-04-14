export type SubtitleJobStatus = 'pending' | 'processing' | 'completed' | 'error';

export interface SubtitleJobRow {
  id:           string;
  name:         string | null;
  execute_id:   string | null;
  status:       SubtitleJobStatus;
  audio_path:   string;
  txt_path:     string;
  video_path:   string | null;
  playlist_url: string | null;
  callback_url: string | null;
  progress:     string | null;
  error:        string | null;
  created_at:   number;
  updated_at:   number;
}

export interface CreateSubtitleJobParams {
  execute_id?:   string;
  audio_path:    string;
  txt_path:      string;
  callback_url?: string;
  name?:         string;
  videoConfig?:  Record<string, unknown>;
}
