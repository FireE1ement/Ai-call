export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
}

export interface Contact {
  id: string;
  userId: string;
  name: string;
  phoneNumber: string;
  email?: string;
  notes?: string;
}

export interface CallRecord {
  id: string;
  userId: string;
  contactId?: string;
  contactName: string;
  timestamp: string;
  duration: number;
  transcription: string;
  aiTask?: string;
  status: 'completed' | 'missed' | 'failed';
}

export interface AITask {
  id: string;
  userId: string;
  title: string;
  instructions: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}
