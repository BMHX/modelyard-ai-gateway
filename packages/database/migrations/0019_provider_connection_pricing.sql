alter table provider_connections
  add column if not exists pricing_config jsonb;

alter table price_snapshots
  add column if not exists cached_input_usd_per_million numeric(14, 6),
  add column if not exists cache_read_input_usd_per_million numeric(14, 6),
  add column if not exists cache_write_5m_input_usd_per_million numeric(14, 6),
  add column if not exists cache_write_1h_input_usd_per_million numeric(14, 6),
  add column if not exists long_context_threshold_input_tokens integer,
  add column if not exists long_context_input_usd_per_million numeric(14, 6),
  add column if not exists long_context_output_usd_per_million numeric(14, 6),
  add column if not exists long_context_cache_read_input_usd_per_million numeric(14, 6),
  add column if not exists long_context_cache_write_5m_input_usd_per_million numeric(14, 6),
  add column if not exists long_context_cache_write_1h_input_usd_per_million numeric(14, 6);

alter table usage_ledger_entries
  add column if not exists cached_input_usd_per_million numeric(14, 6),
  add column if not exists cache_read_input_usd_per_million numeric(14, 6),
  add column if not exists cache_write_5m_input_usd_per_million numeric(14, 6),
  add column if not exists cache_write_1h_input_usd_per_million numeric(14, 6),
  add column if not exists long_context_threshold_input_tokens integer,
  add column if not exists long_context_input_usd_per_million numeric(14, 6),
  add column if not exists long_context_output_usd_per_million numeric(14, 6),
  add column if not exists long_context_cache_read_input_usd_per_million numeric(14, 6),
  add column if not exists long_context_cache_write_5m_input_usd_per_million numeric(14, 6),
  add column if not exists long_context_cache_write_1h_input_usd_per_million numeric(14, 6);
