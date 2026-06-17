import {
  PageContainer,
  ProForm,
  ProFormDependency,
  ProFormSelect,
  ProFormText,
} from '@ant-design/pro-components';
import { Alert, Button, Card, Modal, message, Spin, Tabs } from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import {
  type CodeAgentConfigDTO,
  getCodeAgentConfig,
  getCodeAgentProviderList,
  getLlmConfig,
  getLlmProviderList,
  type LLMConfigDTO,
  testCodeAgentConfig,
  testLlmConfig,
  updateCodeAgentConfig,
  updateLlmConfig,
} from '@/services/aiConfig';

const CUSTOM_PROVIDER_VALUE = '__custom__';
/** 内置 Provider 列表选型（非自定义）时写入 configs 的 type */
const PRESET_LLM_TYPE = 'builtin';
const CODE_AGENT_ENGINE_OPTIONS = [{ label: 'Open Code', value: 'opencode' }];

type ProviderModelItem = string | { id?: string; type?: string };

type FormState = {
  llm: Required<
    Pick<LLMConfigDTO, 'LLM_provider' | 'LLM_model' | 'LLM_baseurl'>
  > & {
    LLM_key?: string;
  };
  codeAgent: Required<
    Pick<
      CodeAgentConfigDTO,
      | 'code_agent_provider'
      | 'code_agent_model'
      | 'code_agent_baseurl'
      | 'code_agent_engine'
    >
  > & {
    code_agent_key?: string;
  };
};

const DEFAULT_CONFIG: FormState = {
  llm: {
    LLM_provider: '',
    LLM_model: '',
    LLM_baseurl: '',
    LLM_key: '',
  },
  codeAgent: {
    code_agent_provider: '',
    code_agent_model: '',
    code_agent_baseurl: '',
    code_agent_engine: 'opencode',
    code_agent_key: '',
  },
};

const normalizeProviderList = (providerList: any): Record<string, any> => {
  if (!providerList || typeof providerList !== 'object') {
    return {};
  }
  if (Array.isArray(providerList?.providers)) {
    return normalizeProviderList(providerList.providers);
  }
  if (Array.isArray(providerList)) {
    return providerList.reduce<Record<string, any>>((acc, item) => {
      if (item && typeof item === 'object' && typeof item.id === 'string') {
        acc[item.id] = item;
      }
      return acc;
    }, {});
  }
  if (
    providerList &&
    typeof providerList.id === 'string' &&
    Array.isArray(providerList.models)
  ) {
    return { [providerList.id]: providerList };
  }
  return providerList as Record<string, any>;
};

const buildProviderOptions = (providerList: Record<string, any>) => {
  const entries = Object.entries(providerList || {}).filter(
    ([provider, detail]) =>
      provider !== 'providers' &&
      detail &&
      typeof detail === 'object' &&
      (Array.isArray(detail.models) ||
        typeof detail.provider_type === 'string' ||
        typeof detail.name === 'string'),
  );
  const popular = entries
    .filter(([, detail]) => detail?.provider_type === 'popular')
    .map(([provider, detail]) => ({
      label: detail?.name ? `${detail.name} (${provider})` : provider,
      value: provider,
    }));
  const others = entries
    .filter(([, detail]) => detail?.provider_type !== 'popular')
    .map(([provider, detail]) => ({
      label: detail?.name ? `${detail.name} (${provider})` : provider,
      value: provider,
    }));

  const grouped: Array<Record<string, any>> = [
    {
      label: '自定义',
      options: [{ label: '自定义 Provider', value: CUSTOM_PROVIDER_VALUE }],
    },
  ];
  if (popular.length) {
    grouped.push({ label: 'Popular', options: popular });
  }
  if (others.length) {
    grouped.push({ label: '其他', options: others });
  }
  return grouped;
};

const getProviderModels = (
  providerList: Record<string, any>,
  provider?: string,
) => {
  if (!provider || provider === CUSTOM_PROVIDER_VALUE) {
    return [];
  }
  const models = providerList?.[provider]?.models as
    | ProviderModelItem[]
    | undefined;
  if (!Array.isArray(models)) {
    return [];
  }
  const parsed = models
    .map((model, index) => {
      if (typeof model === 'string') {
        return { label: model, value: model, isFree: false, index };
      }
      if (model && typeof model === 'object' && typeof model.id === 'string') {
        const label = model.type === 'free' ? `${model.id}（免费）` : model.id;
        return {
          label,
          value: model.id,
          isFree: model.type === 'free',
          index,
        };
      }
      return null;
    })
    .filter(Boolean) as Array<{
    label: string;
    value: string;
    isFree: boolean;
    index: number;
  }>;

  parsed.sort((a, b) => {
    if (a.isFree !== b.isFree) {
      return a.isFree ? -1 : 1;
    }
    return a.index - b.index;
  });

  return parsed.map(({ label, value }) => ({ label, value }));
};

const isProviderModelFree = (
  providerList: Record<string, any>,
  provider?: string | null,
  modelId?: string | null,
) => {
  if (!provider || !modelId || provider === CUSTOM_PROVIDER_VALUE) {
    return false;
  }
  const models = providerList?.[provider]?.models as
    | ProviderModelItem[]
    | undefined;
  if (!Array.isArray(models)) {
    return false;
  }
  const target = models.find((model) => {
    if (typeof model === 'string') {
      return model === modelId;
    }
    return model?.id === modelId;
  });
  return (
    !!target &&
    typeof target === 'object' &&
    target !== null &&
    target.type === 'free'
  );
};

const formatJsonDisplay = (value: unknown): string => {
  let current: unknown = value;
  for (let i = 0; i < 3; i += 1) {
    if (typeof current !== 'string') {
      break;
    }
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  if (typeof current === 'string') {
    return current;
  }
  try {
    return JSON.stringify(current, null, 2);
  } catch {
    return String(current);
  }
};

const AiSettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [testingLlm, setTestingLlm] = useState(false);
  const [testingCodeAgent, setTestingCodeAgent] = useState(false);
  const [config, setConfig] = useState<FormState>(DEFAULT_CONFIG);
  const [llmProviderList, setLlmProviderList] = useState<Record<string, any>>(
    {},
  );
  const [codeAgentProviderList, setCodeAgentProviderList] = useState<
    Record<string, any>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [llmRes, codeAgentRes, llmProviderRes, codeAgentProviderRes] =
        await Promise.all([
          getLlmConfig(),
          getCodeAgentConfig(),
          getLlmProviderList(),
          getCodeAgentProviderList(),
        ]);

      const llmData = llmRes?.data || {};
      const codeAgentData = codeAgentRes?.data || {};
      const isCustomLlm = llmData.type === 'custom';
      const isCustomCodeAgent = codeAgentData.type === 'custom';
      const llmProviders = normalizeProviderList(llmProviderRes?.data || {});
      const codeAgentProviders = normalizeProviderList(
        codeAgentProviderRes?.data || {},
      );

      setConfig({
        llm: {
          LLM_provider: isCustomLlm
            ? CUSTOM_PROVIDER_VALUE
            : llmData.LLM_provider || 'deepseek',
          LLM_model: isCustomLlm ? '' : llmData.LLM_model || '',
          LLM_baseurl: isCustomLlm ? '' : llmData.LLM_baseurl || '',
          LLM_key: isCustomLlm ? '' : llmData.LLM_key || '',
          ...(isCustomLlm
            ? {
                LLM_custom_provider: llmData.LLM_provider || '',
                LLM_custom_model: llmData.LLM_model || '',
                LLM_custom_baseurl: llmData.LLM_baseurl || '',
                LLM_custom_key: llmData.LLM_key || '',
                LLM_custom_format: llmData.LLM_format || 'openai',
              }
            : {}),
        },
        codeAgent: {
          code_agent_provider: isCustomCodeAgent
            ? CUSTOM_PROVIDER_VALUE
            : codeAgentData.code_agent_provider || 'opencode',
          code_agent_model: isCustomCodeAgent
            ? ''
            : codeAgentData.code_agent_model || '',
          code_agent_baseurl: isCustomCodeAgent
            ? ''
            : codeAgentData.code_agent_baseurl || '',
          code_agent_engine: codeAgentData.code_agent_engine || 'opencode',
          code_agent_key: isCustomCodeAgent
            ? ''
            : codeAgentData.code_agent_key || '',
          ...(isCustomCodeAgent
            ? {
                code_agent_custom_provider:
                  codeAgentData.code_agent_provider || '',
                code_agent_custom_model: codeAgentData.code_agent_model || '',
                code_agent_custom_baseurl:
                  codeAgentData.code_agent_baseurl || '',
                code_agent_custom_key: codeAgentData.code_agent_key || '',
              }
            : {}),
        },
      });
      setLlmProviderList(llmProviders);
      setCodeAgentProviderList(codeAgentProviders);
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleTestLlm = useCallback(async () => {
    try {
      setTestingLlm(true);
      const res = await testLlmConfig();
      const isBizError = res?.success === false;
      const displaySource = isBizError
        ? {
            code: (res as any)?.code,
            message: (res as any)?.message || '测试失败',
            data: (res as any)?.data,
          }
        : (res?.data ?? '');
      const content = formatJsonDisplay(displaySource);
      const modalConfig = {
        title: isBizError ? '主 LLM 测试失败' : '主 LLM 测试结果',
        width: 720,
        content: (
          <pre
            style={{
              maxHeight: 420,
              overflow: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {content}
          </pre>
        ),
      };
      if (isBizError) {
        Modal.error(modalConfig);
      } else {
        Modal.info(modalConfig);
      }
    } catch (error: any) {
      const displaySource =
        error?.info?.data ??
        error?.response?.data ??
        error?.message ??
        '测试失败';
      Modal.error({
        title: '主 LLM 测试失败',
        width: 720,
        content: (
          <pre
            style={{
              maxHeight: 420,
              overflow: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {formatJsonDisplay(displaySource)}
          </pre>
        ),
      });
    } finally {
      setTestingLlm(false);
    }
  }, []);

  const handleTestCodeAgent = useCallback(async () => {
    try {
      setTestingCodeAgent(true);
      const res = await testCodeAgentConfig();
      const isBizError = res?.success === false;
      const displaySource = isBizError
        ? {
            code: (res as any)?.code,
            message: (res as any)?.message || '测试失败',
            data: (res as any)?.data,
          }
        : (res?.data ?? '');
      const content = formatJsonDisplay(displaySource);
      const modalConfig = {
        title: isBizError ? 'Code Agent 测试失败' : 'Code Agent 测试结果',
        width: 720,
        content: (
          <pre
            style={{
              maxHeight: 420,
              overflow: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {content}
          </pre>
        ),
      };
      if (isBizError) {
        Modal.error(modalConfig);
      } else {
        Modal.info(modalConfig);
      }
    } catch (error: any) {
      const displaySource =
        error?.info?.data ??
        error?.response?.data ??
        error?.message ??
        '测试失败';
      Modal.error({
        title: 'Code Agent 测试失败',
        width: 720,
        content: (
          <pre
            style={{
              maxHeight: 420,
              overflow: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {formatJsonDisplay(displaySource)}
          </pre>
        ),
      });
    } finally {
      setTestingCodeAgent(false);
    }
  }, []);

  return (
    <PageContainer title="配置管理">
      <Spin spinning={loading}>
        <Tabs
          items={[
            {
              key: 'main-llm',
              label: '主 LLM',
              children: (
                <Card variant="borderless">
                  <Alert
                    type="info"
                    showIcon
                    message={`当前密钥状态：${config.llm.LLM_key ? '已填写(待保存)' : '未显示明文'}`}
                    style={{ marginBottom: 16 }}
                  />
                  <ProForm<FormState['llm'] & Record<string, any>>
                    key={`llm-${config.llm.LLM_provider}-${config.llm.LLM_model}`}
                    layout="vertical"
                    initialValues={config.llm}
                    onFinish={async (values) => {
                      try {
                        const isCustomProvider =
                          values.LLM_provider === CUSTOM_PROVIDER_VALUE;
                        const payload: LLMConfigDTO = {
                          LLM_provider: isCustomProvider
                            ? values.LLM_custom_provider
                            : values.LLM_provider,
                          LLM_model: isCustomProvider
                            ? values.LLM_custom_model
                            : values.LLM_model,
                          LLM_baseurl: isCustomProvider
                            ? values.LLM_custom_baseurl
                            : config.llm.LLM_baseurl || '',
                          type: isCustomProvider ? 'custom' : PRESET_LLM_TYPE,
                        };
                        payload.LLM_key = isCustomProvider
                          ? values.LLM_custom_key
                          : values.LLM_key;
                        if (isCustomProvider) {
                          payload.LLM_format =
                            values.LLM_custom_format || 'openai';
                        }
                        if (
                          !payload.LLM_provider ||
                          !payload.LLM_model ||
                          (isCustomProvider && !payload.LLM_baseurl) ||
                          (!isCustomProvider && !payload.LLM_key) ||
                          (isCustomProvider && !payload.LLM_key)
                        ) {
                          message.error(
                            isCustomProvider
                              ? '请完善自定义 Provider 所需字段'
                              : '请填写 API Key',
                          );
                          return false;
                        }
                        const res = await updateLlmConfig(payload);
                        if (res.success) {
                          await load();
                          message.success('主 LLM 配置已保存');
                        }
                        return true;
                      } catch {
                        message.error('保存失败');
                        return false;
                      }
                    }}
                    submitter={{
                      searchConfig: { submitText: '保存主 LLM 配置' },
                      render: (_, dom) => [
                        ...dom,
                        <Button
                          key="test-llm"
                          onClick={() => {
                            void handleTestLlm();
                          }}
                          loading={testingLlm}
                        >
                          测试
                        </Button>,
                      ],
                    }}
                  >
                    <ProFormSelect
                      name="LLM_provider"
                      label="Provider"
                      options={buildProviderOptions(llmProviderList)}
                      rules={[{ required: true }]}
                      showSearch
                    />
                    <ProFormDependency name={['LLM_provider']}>
                      {({ LLM_provider }) => (
                        <>
                          {LLM_provider === CUSTOM_PROVIDER_VALUE ? (
                            <>
                              <ProFormText
                                name="LLM_custom_provider"
                                label="自定义 Provider ID"
                                placeholder="如 my-provider"
                                rules={[{ required: true }]}
                              />
                              <ProFormText
                                name="LLM_custom_model"
                                label="自定义模型"
                                placeholder="如 my-model"
                                rules={[{ required: true }]}
                              />
                              <ProFormSelect
                                name="LLM_custom_format"
                                label="API 格式"
                                options={[
                                  { label: 'OpenAI 兼容', value: 'openai' },
                                  { label: 'Anthropic', value: 'anthropic' },
                                ]}
                                tooltip="自定义端点的协议格式。OpenAI 兼容走 /v1/chat/completions；Anthropic 走 /v1/messages"
                                rules={[{ required: true }]}
                              />
                              <ProFormDependency name={['LLM_custom_format']}>
                                {({ LLM_custom_format }) => (
                                  <ProFormText
                                    name="LLM_custom_baseurl"
                                    label="自定义 Base URL"
                                    placeholder={
                                      LLM_custom_format === 'anthropic'
                                        ? 'https://api.example.com/anthropic'
                                        : 'https://api.example.com/v1'
                                    }
                                    rules={[{ required: true }]}
                                  />
                                )}
                              </ProFormDependency>
                              <ProFormText
                                name="LLM_custom_key"
                                label="自定义 API Key"
                                rules={[{ required: true }]}
                              />
                            </>
                          ) : (
                            <>
                              <ProFormSelect
                                name="LLM_model"
                                label="模型名"
                                options={getProviderModels(
                                  llmProviderList,
                                  LLM_provider,
                                )}
                                rules={[{ required: true }]}
                                showSearch
                              />
                              <ProFormText
                                name="LLM_key"
                                label="API Key"
                                placeholder="请输入 API Key"
                                rules={[
                                  { required: true, message: '请输入 API Key' },
                                ]}
                              />
                            </>
                          )}
                        </>
                      )}
                    </ProFormDependency>
                  </ProForm>
                </Card>
              ),
            },
            {
              key: 'code-agent',
              label: 'Code Agent',
              children: (
                <Card variant="borderless">
                  <ProForm<FormState['codeAgent'] & Record<string, any>>
                    key={`agent-${config.codeAgent.code_agent_engine}-${config.codeAgent.code_agent_model}`}
                    layout="vertical"
                    initialValues={config.codeAgent}
                    onFinish={async (values) => {
                      try {
                        const isCustomProvider =
                          values.code_agent_provider === CUSTOM_PROVIDER_VALUE;
                        const isFreeModel = isProviderModelFree(
                          codeAgentProviderList,
                          values.code_agent_provider,
                          values.code_agent_model,
                        );
                        const payload: CodeAgentConfigDTO = {
                          code_agent_provider: isCustomProvider
                            ? values.code_agent_custom_provider
                            : values.code_agent_provider,
                          code_agent_model: isCustomProvider
                            ? values.code_agent_custom_model
                            : values.code_agent_model,
                          code_agent_baseurl: isCustomProvider
                            ? values.code_agent_custom_baseurl
                            : config.codeAgent.code_agent_baseurl || '',
                          code_agent_engine: values.code_agent_engine,
                          ...(isCustomProvider ? { type: 'custom' } : {}),
                        };
                        payload.code_agent_key = isCustomProvider
                          ? values.code_agent_custom_key
                          : values.code_agent_key || '';
                        if (
                          !payload.code_agent_provider ||
                          !payload.code_agent_model ||
                          (isCustomProvider && !payload.code_agent_baseurl) ||
                          (!isCustomProvider &&
                            !isFreeModel &&
                            !payload.code_agent_key) ||
                          (isCustomProvider && !payload.code_agent_key)
                        ) {
                          message.error(
                            isCustomProvider
                              ? '请完善自定义 Provider 所需字段'
                              : '请填写 API Key',
                          );
                          return false;
                        }
                        const res = await updateCodeAgentConfig(payload);
                        if (res.success) {
                          await load();
                          message.success('Code Agent 配置已保存');
                        }
                        return true;
                      } catch {
                        message.error('保存失败');
                        return false;
                      }
                    }}
                    submitter={{
                      searchConfig: { submitText: '保存 Code Agent 配置' },
                      render: (_, dom) => [
                        ...dom,
                        <Button
                          key="test-code-agent"
                          onClick={() => {
                            void handleTestCodeAgent();
                          }}
                          loading={testingCodeAgent}
                        >
                          测试
                        </Button>,
                      ],
                    }}
                  >
                    <ProFormSelect
                      name="code_agent_engine"
                      label="引擎"
                      options={CODE_AGENT_ENGINE_OPTIONS}
                      initialValue="opencode"
                      rules={[{ required: true }]}
                    />
                    <ProFormSelect
                      name="code_agent_provider"
                      label="Provider"
                      options={buildProviderOptions(codeAgentProviderList)}
                      rules={[{ required: true }]}
                      showSearch
                    />
                    <ProFormDependency
                      name={['code_agent_provider', 'code_agent_model']}
                    >
                      {({ code_agent_provider, code_agent_model }) => (
                        <>
                          {code_agent_provider === CUSTOM_PROVIDER_VALUE ? (
                            <>
                              <ProFormText
                                name="code_agent_custom_provider"
                                label="自定义 Provider ID"
                                placeholder="如 my-code-agent-provider"
                                rules={[{ required: true }]}
                              />
                              <ProFormText
                                name="code_agent_custom_model"
                                label="自定义模型"
                                placeholder="如 my-code-agent-model"
                                rules={[{ required: true }]}
                              />
                              <ProFormText
                                name="code_agent_custom_baseurl"
                                label="自定义 Base URL"
                                placeholder="https://example.com/v1"
                                rules={[{ required: true }]}
                              />
                              <ProFormText
                                name="code_agent_custom_key"
                                label="自定义 API Key"
                                rules={[{ required: true }]}
                              />
                            </>
                          ) : (
                            <>
                              {(() => {
                                const isFreeModel = isProviderModelFree(
                                  codeAgentProviderList,
                                  code_agent_provider,
                                  code_agent_model,
                                );
                                return (
                                  <>
                                    <ProFormSelect
                                      name="code_agent_model"
                                      label="模型名"
                                      options={getProviderModels(
                                        codeAgentProviderList,
                                        code_agent_provider,
                                      )}
                                      rules={[{ required: true }]}
                                      showSearch
                                    />
                                    {!isFreeModel && (
                                      <ProFormText
                                        name="code_agent_key"
                                        label="API Key"
                                        placeholder="请输入 API Key"
                                        rules={[
                                          {
                                            required: true,
                                            message: '请输入 API Key',
                                          },
                                        ]}
                                      />
                                    )}
                                  </>
                                );
                              })()}
                            </>
                          )}
                        </>
                      )}
                    </ProFormDependency>
                  </ProForm>
                </Card>
              ),
            },
          ]}
        />
      </Spin>
    </PageContainer>
  );
};

export default AiSettingsPage;
