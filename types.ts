
export interface Company {
  id: number;
  name: string;
  docNumber: string; // CPF or CNPJ
  type: 'CNPJ' | 'CPF' | 'MEI';
  email: string;
  whatsapp: string;
}

export enum TaskStatus {
  PENDING = 'pendente',
  IN_PROGRESS = 'em_andamento',
  DONE = 'concluida'
}

export enum TaskPriority {
  LOW = 'baixa',
  MEDIUM = 'media',
  HIGH = 'alta'
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  color: string;
  dueDate?: string;
  createdAt?: string; // Data de criação (YYYY-MM-DD)
  companyId?: number;
  // Recurrence fields
  recurrence?: 'nenhuma' | 'diaria' | 'semanal' | 'mensal' | 'trimestral' | 'semestral' | 'anual';
  dayOfWeek?: 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado' | 'domingo';
  recurrenceDate?: string;
  targetCompanyType?: 'normal' | 'mei'; 
}

export interface Document {
  id: number;
  name: string;
  category: string;
  competence: string;
  dueDate: string;
  status: 'pending' | 'sent';
  companyId: number;
  companyName: string;
  file?: File; // Optional, might be a manual matrix entry
  serverFilename?: string; // The file saved on server
  isManual?: boolean;
}

export interface ScheduledMessage {
  id: number;
  title: string;
  message?: string;
  nextRun: string;
  recurrence: string;
  active: boolean;
  type: 'message' | 'documents';
  channels: {
    email: boolean;
    whatsapp: boolean;
  };
  targetType: 'normal' | 'mei' | 'selected';
  selectedCompanyIds?: number[];
  attachmentFilename?: string;
  attachmentOriginalName?: string;
  documentsPayload?: string; // JSON string of Document[]
}

export interface UploadedFile {
  name: string;
  size: number;
  category: string;
  dueDate: string;
  file: File;
  serverFilename?: string;
}

export interface CategoryRule {
  day: number;
  rule: 'antecipado' | 'postergado' | 'quinto_dia_util' | 'ultimo_dia_util' | 'fixo';
}

export interface UserSettings {
  emailSignature: string;
  whatsappTemplate: string;
  visibleDocumentCategories: string[];
  customCategories: string[]; // Categorias criadas pelo usuário
  categoryKeywords: Record<string, string[]>;
  priorityCategories: string[]; 
  categoryRules: Record<string, CategoryRule>;
  dailySummaryNumber: string; // Número para receber o resumo das tarefas
  dailySummaryTime: string; // Horário do envio (ex: "08:00")
  aiEnabled?: boolean; // Ativar/Desativar IA
}

// Kanban WhatsApp Types
export interface Column {
  id: string;
  name: string;
  position: number;
  color?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Chat {
  id: string;
  name?: string;
  phone?: string;
  column_id: string;
  last_message?: string;
  last_message_time?: number;
  unread_count: number;
  profile_pic?: string;
  tag_ids: string[];
  last_message_from_me?: number;
}

export interface Message {
  id: string;
  chat_id: string;
  body?: string;
  from_me: number;
  timestamp: number;
  media_url?: string;
  media_type?: string;
  media_name?: string;
  transcription?: string;
}
