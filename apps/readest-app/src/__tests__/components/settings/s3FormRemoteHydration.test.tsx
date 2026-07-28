import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: vi.fn() },
    appService: { saveFile: vi.fn() },
  }),
}));

vi.mock('@/services/sync/providers/s3/S3Provider', () => ({
  createS3Provider: vi.fn(),
}));

vi.mock('@/components/settings/integrations/FileSyncForm', () => ({
  default: () => <div>File sync</div>,
}));

import S3Form from '@/components/settings/integrations/S3Form';

const makeSettings = (s3: SystemSettings['s3']): SystemSettings =>
  ({
    globalReadSettings: {},
    globalViewSettings: {},
    s3,
  }) as SystemSettings;

beforeEach(() => {
  useSettingsStore.setState({
    settings: makeSettings({
      enabled: false,
      endpoint: '',
      region: 'auto',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
    } as SystemSettings['s3']),
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe('S3Form remote settings hydration', () => {
  test('refreshes an untouched connection form when replica settings arrive asynchronously', () => {
    render(<S3Form />);

    act(() => {
      useSettingsStore.setState({
        settings: makeSettings({
          enabled: false,
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'readest',
          accessKeyId: 'AKIA',
          secretAccessKey: 'secret',
        } as SystemSettings['s3']),
      });
    });

    expect((screen.getByLabelText('Endpoint') as HTMLInputElement).value).toBe(
      'https://s3.example.com',
    );
    expect((screen.getByLabelText('Bucket') as HTMLInputElement).value).toBe('readest');
    expect((screen.getByLabelText('Region') as HTMLInputElement).value).toBe('us-east-1');
    expect((screen.getByLabelText('Access Key ID') as HTMLInputElement).value).toBe('AKIA');
    expect((screen.getByLabelText('Secret Access Key') as HTMLInputElement).value).toBe('secret');
  });

  test('does not overwrite an in-progress local edit when remote settings arrive', () => {
    render(<S3Form />);
    const endpointInput = screen.getByLabelText('Endpoint');
    fireEvent.change(endpointInput, { target: { value: 'https://typing.example.com' } });

    act(() => {
      useSettingsStore.setState({
        settings: makeSettings({
          enabled: false,
          endpoint: 'https://remote.example.com',
          region: 'us-west-2',
          bucket: 'remote-bucket',
          accessKeyId: 'REMOTE',
          secretAccessKey: 'remote-secret',
        } as SystemSettings['s3']),
      });
    });

    expect((endpointInput as HTMLInputElement).value).toBe('https://typing.example.com');
  });
});
