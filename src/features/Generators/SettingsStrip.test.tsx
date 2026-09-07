import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import SettingsStrip, { AdvancedItem, SettingsChip } from './SettingsStrip';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

describe('SettingsChip (desktop)', () => {
  it('opens its popover on click when it has no tooltip', () => {
    render(
      <SettingsChip ariaLabel="Модель" content={() => <div>picker-body</div>} label="Kling" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Модель' }));
    expect(screen.getByText('picker-body')).toBeTruthy();
  });

  it('still opens its popover on click when it carries a tooltip (locked / mismatch state)', () => {
    render(
      <SettingsChip
        ariaLabel="Модель"
        content={() => <div>picker-body</div>}
        indicator="locked"
        label="Kling"
        tooltip="Стиль настроен под другую модель"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Модель' }));
    expect(screen.getByText('picker-body')).toBeTruthy();
  });
});

describe('SettingsStrip', () => {
  const renderStrip = (advanced?: React.ReactNode) =>
    render(
      <MemoryRouter>
        <SettingsStrip advanced={advanced} cost={{ credits: 12, sufficient: true }}>
          <span>chip-a</span>
          <span>chip-b</span>
        </SettingsStrip>
      </MemoryRouter>,
    );

  it('discloses the advanced panel inline with an aria-expanded toggle, no drawer', () => {
    renderStrip(<div>advanced-body</div>);
    const toggle = screen.getByRole('button', { expanded: false });
    expect(screen.queryByText('advanced-body')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('advanced-body')).toBeTruthy();
    expect(document.querySelector('.ant-drawer')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.queryByText('advanced-body')).toBeNull();
  });

  it('renders no toggle when the model has nothing beyond the chips', () => {
    renderStrip(undefined);
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
    expect(screen.getByText('chip-a')).toBeTruthy();
  });
});

describe('AdvancedItem', () => {
  it('keeps a locked knob visible as one compact row: name + lock + reason, no control', () => {
    render(
      <AdvancedItem label="Сид" lock="Задаёт стиль">
        <input aria-label="seed" />
      </AdvancedItem>,
    );
    expect(screen.getByText('Сид')).toBeTruthy();
    expect(screen.getByText('Задаёт стиль')).toBeTruthy();
    expect(screen.queryByLabelText('seed')).toBeNull();
  });

  it('renders a free knob with its control and no lock chrome', () => {
    render(
      <AdvancedItem label="Сид">
        <input aria-label="seed" />
      </AdvancedItem>,
    );
    expect(screen.getByLabelText('seed')).toBeTruthy();
    expect(document.querySelector('[aria-disabled]')).toBeNull();
  });
});
