import { useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

// ── Shared types (imported by App.tsx) ────────────────────────

export interface Deal {
  id: string;
  name: string;
  sector: string;
  status: string;
  verdict: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoadedDealData {
  documents: Array<{
    filename: string;
    file_type: string;
    extracted_text: string;
  }>;
  analysis: {
    assessment: any;
    claims: any;
    conflicts: any;
    charts_data: any;
    comps_data: any;
  } | null;
  chatMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
    segments?: any[];
    timestamp?: string;
  }>;
}

// ── Hook ──────────────────────────────────────────────────────

export function useDealPersistence() {
  const [saveError, setSaveError] = useState(false);

  /** Wraps any DB call — logs errors, shows indicator, never throws. */
  const safe = useCallback(async (fn: () => Promise<void>) => {
    if (!supabase) return;
    try {
      await fn();
    } catch (err) {
      console.error('[DealPersistence]', err);
      setSaveError(true);
      setTimeout(() => setSaveError(false), 3000);
    }
  }, []);

  // ── Reads ────────────────────────────────────────────────────

  const loadDeals = useCallback(async (): Promise<Deal[]> => {
    if (!supabase) {
      console.log('[DealPersistence] loadDeals: supabase not configured, returning []');
      return [];
    }
    try {
      console.log('[DealPersistence] loadDeals: fetching from DB...');
      const { data, error } = await supabase
        .from('deals')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      console.log('[DealPersistence] loadDeals: got', (data ?? []).length, 'deals');
      return data ?? [];
    } catch (err) {
      console.error('[DealPersistence] loadDeals:', err);
      return [];
    }
  }, []);

  const loadDeal = useCallback(async (dealId: string): Promise<LoadedDealData | null> => {
    if (!supabase) return null;
    try {
      const [docsResult, analysisResult, chatResult] = await Promise.all([
        supabase
          .from('deal_documents')
          .select('*')
          .eq('deal_id', dealId)
          .order('uploaded_at'),
        supabase
          .from('deal_analyses')
          .select('*')
          .eq('deal_id', dealId)
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('deal_chat_messages')
          .select('*')
          .eq('deal_id', dealId)
          .order('created_at'),
      ]);

      return {
        documents: (docsResult.data ?? []).map((d: any) => ({
          filename: d.filename,
          file_type: d.file_type,
          extracted_text: d.extracted_text ?? '',
        })),
        analysis: analysisResult.data?.[0]
          ? {
              assessment: analysisResult.data[0].assessment,
              claims: analysisResult.data[0].claims,
              conflicts: analysisResult.data[0].conflicts,
              charts_data: analysisResult.data[0].charts_data,
              comps_data: analysisResult.data[0].comps_data,
            }
          : null,
        chatMessages: (chatResult.data ?? []).map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          segments: m.segments ?? undefined,
          timestamp: m.timestamp ?? undefined,
        })),
      };
    } catch (err) {
      console.error('[DealPersistence] loadDeal:', err);
      return null;
    }
  }, []);

  // ── Writes ───────────────────────────────────────────────────

  const createDeal = useCallback(async (name: string, sector: string): Promise<Deal | null> => {
    if (!supabase) {
      console.log('[DealPersistence] createDeal: supabase not configured');
      return null;
    }
    try {
      console.log('[DealPersistence] createDeal: inserting deal:', name);
      const { data, error } = await supabase
        .from('deals')
        .insert({ name, sector, status: 'Active', verdict: null })
        .select()
        .single();
      if (error) throw error;
      console.log('[DealPersistence] createDeal: success, id:', (data as Deal).id);
      return data as Deal;
    } catch (err) {
      console.error('[DealPersistence] createDeal:', err);
      return null;
    }
  }, []);

  const saveDeal = useCallback(async (dealId: string, updates: Partial<Deal>) => {
    await safe(async () => {
      const { error } = await supabase!
        .from('deals')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', dealId);
      if (error) throw error;
    });
  }, [safe]);

  const saveDocument = useCallback(async (
    dealId: string,
    filename: string,
    fileType: string,
    extractedText: string,
  ) => {
    await safe(async () => {
      // Upsert by (deal_id, filename) to avoid duplicate entries on re-analysis
      const { error } = await supabase!
        .from('deal_documents')
        .upsert(
          { deal_id: dealId, filename, file_type: fileType, extracted_text: extractedText },
          { onConflict: 'deal_id,filename', ignoreDuplicates: false },
        );
      if (error) throw error;
    });
  }, [safe]);

  const saveAnalysis = useCallback(async (
    dealId: string,
    assessment: any,
    claims: any,
    conflicts: any,
    chartsData: any,
    compsData: any,
  ) => {
    await safe(async () => {
      // Check for existing analysis row for this deal
      const { data: existing } = await supabase!
        .from('deal_analyses')
        .select('id')
        .eq('deal_id', dealId)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase!
          .from('deal_analyses')
          .update({ assessment, claims, conflicts, charts_data: chartsData, comps_data: compsData })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase!
          .from('deal_analyses')
          .insert({ deal_id: dealId, assessment, claims, conflicts, charts_data: chartsData, comps_data: compsData });
        if (error) throw error;
      }
    });
  }, [safe]);

  const deleteDocument = useCallback(async (dealId: string, filename: string) => {
    await safe(async () => {
      const { error } = await supabase!
        .from('deal_documents')
        .delete()
        .eq('deal_id', dealId)
        .eq('filename', filename);
      if (error) throw error;
    });
  }, [safe]);

  const deleteDeal = useCallback(async (dealId: string) => {
    await safe(async () => {
      // Delete files from storage bucket first
      const { data: files } = await supabase!.storage.from('deal-files').list(dealId);
      if (files && files.length > 0) {
        const paths = files.map(f => `${dealId}/${f.name}`);
        await supabase!.storage.from('deal-files').remove(paths);
      }
      // Delete child rows first (FK constraints), then the deal itself
      await supabase!.from('deal_chat_messages').delete().eq('deal_id', dealId);
      await supabase!.from('deal_analyses').delete().eq('deal_id', dealId);
      await supabase!.from('deal_documents').delete().eq('deal_id', dealId);
      const { error } = await supabase!.from('deals').delete().eq('id', dealId);
      if (error) throw error;
    });
  }, [safe]);

  // ── Storage ──────────────────────────────────────────────────

  const uploadFilesToStorage = useCallback(async (dealId: string, files: File[]) => {
    if (!supabase || !files.length) return;
    await Promise.all(files.map(async (file) => {
      const path = `${dealId}/${file.name}`;
      const { error } = await supabase!.storage
        .from('deal-files')
        .upload(path, file, { upsert: true });
      if (error) console.error('[Storage] upload failed:', file.name, error.message);
    }));
  }, []);

  const downloadFilesFromStorage = useCallback(async (dealId: string, filenames: string[]): Promise<File[]> => {
    if (!supabase || !filenames.length) return [];
    const results = await Promise.all(filenames.map(async (filename) => {
      const path = `${dealId}/${filename}`;
      const { data, error } = await supabase!.storage.from('deal-files').download(path);
      if (error || !data) {
        console.warn('[Storage] download failed:', filename, error?.message);
        return null;
      }
      return new File([data], filename, { type: data.type });
    }));
    return results.filter((f): f is File => f !== null);
  }, []);

  const deleteFileFromStorage = useCallback(async (dealId: string, filename: string) => {
    if (!supabase) return;
    const { error } = await supabase!.storage
      .from('deal-files')
      .remove([`${dealId}/${filename}`]);
    if (error) console.warn('[Storage] delete failed:', filename, error.message);
  }, []);

  const saveChatMessage = useCallback(async (dealId: string, message: {
    role: string;
    content: string;
    segments?: any[];
    timestamp?: string;
  }) => {
    await safe(async () => {
      const { error } = await supabase!
        .from('deal_chat_messages')
        .insert({
          deal_id: dealId,
          role: message.role,
          content: message.content,
          segments: message.segments ?? null,
          timestamp: message.timestamp ?? null,
        });
      if (error) throw error;
    });
  }, [safe]);

  return {
    // Reads
    loadDeals,
    loadDeal,
    // Writes
    createDeal,
    saveDeal,
    saveDocument,
    deleteDocument,
    saveAnalysis,
    saveChatMessage,
    deleteDeal,
    // Storage
    uploadFilesToStorage,
    downloadFilesFromStorage,
    deleteFileFromStorage,
    // UI state
    saveError,
  };
}
