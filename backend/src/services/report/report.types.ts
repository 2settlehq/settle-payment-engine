/**
 * Reportly Types
 *
 * TypeScript interfaces for the fraud/complaint reporting system.
 */

export interface Report {
  id: number;
  reportId: string;
  apiKeyId: number;
  merchantId: string;
  sessionReference: string | null;
  complaintType: 'track_transaction' | 'stolen_funds' | 'fraud';
  name: string;
  phoneNumber: string | null;
  walletAddress: string | null;
  fraudsterWalletAddress: string | null;
  description: string | null;
  status: 'pending' | 'processing' | 'resolved' | 'dismissed';
  confirmer: string | null;
  adminNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReportInput {
  apiKeyId: number;
  merchantId: string;
  sessionReference?: string;
  complaintType: 'track_transaction' | 'stolen_funds' | 'fraud';
  name: string;
  phoneNumber?: string;
  walletAddress?: string;
  fraudsterWalletAddress?: string;
  description?: string;
}

export interface UpdateReportInput {
  status?: 'pending' | 'processing' | 'resolved' | 'dismissed';
  confirmer?: string;
  adminNotes?: string;
}

export interface ReportFilters {
  status?: string;
  complaintType?: string;
  from?: string;
  to?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface UserReportFilters extends ReportFilters {
  phoneNumber?: string;
  walletAddress?: string;
}

export interface AdminReportFilters extends ReportFilters {
  merchantId?: string;
  apiKeyId?: number;
}
