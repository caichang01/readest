import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import AccountActions from '@/app/user/components/AccountActions';
import UserInfo from '@/app/user/components/UserInfo';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

afterEach(cleanup);

describe('subscription-free account surfaces', () => {
  test('profile identity does not render a membership plan badge', () => {
    render(<UserInfo userFullName='Reader' userEmail='reader@example.com' />);

    expect(screen.getByText('Reader')).toBeTruthy();
    expect(screen.getByText('reader@example.com')).toBeTruthy();
    expect(screen.queryByText(/Free|Plus|Pro|Lifetime/)).toBeNull();
  });

  test('account actions omit purchase and subscription controls', () => {
    render(
      <AccountActions
        onLogout={vi.fn()}
        onResetPassword={vi.fn()}
        onUpdateEmail={vi.fn()}
        onConfirmDelete={vi.fn()}
        onManageStorage={vi.fn()}
        onManageSharedLinks={vi.fn()}
        onManageSync={vi.fn()}
      />,
    );

    expect(screen.queryByText('Restore Purchase')).toBeNull();
    expect(screen.queryByText('Manage Subscription')).toBeNull();
    expect(screen.getByText('Manage Storage')).toBeTruthy();
    expect(screen.getByText('Manage Sync')).toBeTruthy();
  });
});
