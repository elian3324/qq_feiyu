// Pure configuration transformation; this module performs no I/O.
export function applyEnvironment(config, env = process.env) {
  const cfg = structuredClone(config);
  cfg.baseUrl = env.AI_BASE_URL || cfg.baseUrl;
  cfg.model = env.AI_MODEL || cfg.model;
  const providerKey = String(cfg.baseUrl || '').includes('dashscope') ? env.DASHSCOPE_API_KEY : env.DEEPSEEK_API_KEY;
  cfg.apiKey = env.AI_API_KEY || cfg.apiKey || providerKey || '';
  cfg.onebot = { ...cfg.onebot,
    wsUrl: env.ONEBOT_WS_URL || cfg.onebot?.wsUrl,
    httpUrl: env.ONEBOT_HTTP_URL || cfg.onebot?.httpUrl,
    accessToken: env.ONEBOT_ACCESS_TOKEN || cfg.onebot?.accessToken || '',
  };
  for (const [section, key] of [['vision','VISION_API_KEY'],['voice','VOICE_API_KEY'],['asr','ASR_API_KEY']]) {
    cfg[section] = { ...cfg[section], apiKey: env[key] || cfg[section]?.apiKey || (section !== 'vision' ? env.DASHSCOPE_API_KEY : '') || '' };
  }
  cfg.qzone = { ...cfg.qzone,
    httpUrl: env.QZONE_HTTP_URL || cfg.qzone?.httpUrl || '',
    accessToken: env.QZONE_ACCESS_TOKEN || cfg.qzone?.accessToken || '',
    protocolModule: env.QZONE_PROTOCOL_MODULE || cfg.qzone?.protocolModule || '',
  };
  return cfg;
}
