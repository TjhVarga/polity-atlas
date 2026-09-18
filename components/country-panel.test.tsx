import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import australiaProfile from '@/public/data/countries/AUS.json';
import indonesiaProfile from '@/public/data/countries/IDN.json';
import japanProfile from '@/public/data/countries/JPN.json';
import usaProfile from '@/public/data/countries/USA.json';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { CountryPanel } from './country-panel';
import { Providers } from './providers';

type ProfileFixture = unknown;

function selectProfile({
  entityId,
  m49,
  name,
  profile,
}: {
  entityId: string;
  m49: string;
  name: string;
  profile: ProfileFixture;
}) {
  useWorkspaceStore.setState({
    selectedEntityId: entityId,
    selectedM49: m49,
    selectedName: name,
    activeTab: 'overview',
  });

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => profile,
    }),
  );
}

function renderPanel() {
  return render(
    <Providers>
      <CountryPanel />
    </Providers>,
  );
}

describe('CountryPanel', () => {
  beforeEach(() => {
    selectProfile({
      entityId: 'state:m49:036',
      m49: '036',
      name: 'Australia',
      profile: australiaProfile,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the source title and external-link icon instead of a numeric reference', async () => {
    renderPanel();

    const link = await screen.findByRole('link', {
      name: "Source: Australia's system of government",
    });

    expect(link).toHaveTextContent("Australia's system of government");
    expect(link).not.toHaveTextContent('[1]');
    expect(link.querySelector('svg')).not.toBeNull();
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows full post-election compositions for Australian chambers', async () => {
    useWorkspaceStore.setState({ activeTab: 'parliament' });

    renderPanel();

    const houseSemicircle = await screen.findByLabelText(
      'House of Representatives post-election composition semicircle',
    );
    expect(houseSemicircle.tagName.toLowerCase()).toBe('svg');

    const houseBackground = houseSemicircle.querySelector(
      '[data-seat-arc-background]',
    );
    expect(houseBackground).toHaveAttribute('stroke-width', '24');

    expect(
      houseSemicircle.querySelector(
        '[data-party-segment="au-australian_labor_party_alp"]',
      ),
    ).not.toBeNull();

    expect(screen.getByText('40 of 76 seats contested')).toBeInTheDocument();
    expect(
      screen.getAllByText(
        'This is the full chamber immediately after the latest election or renewal reported by IPU. It is not necessarily the current composition.',
      ).length,
    ).toBeGreaterThan(0);
    const senateSemicircle = await screen.findByLabelText(
      'Senate post-election composition semicircle',
    );
    expect(
      senateSemicircle.querySelector(
        '[data-party-segment="au-uc01-e20250503-note-australian-labor-party-government"]',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Seats decided in this renewal'),
    ).toBeInTheDocument();
    expect(screen.getByText('Milton Dick')).toBeInTheDocument();
    expect(screen.getByText(/Alternative Vote \(AV\)/)).toBeInTheDocument();
  });

  it('uses IPU full composition for a partial renewal when it is supplied', async () => {
    selectProfile({
      entityId: 'state:m49:840',
      m49: '840',
      name: 'United States',
      profile: usaProfile,
    });
    useWorkspaceStore.setState({ activeTab: 'parliament' });

    renderPanel();

    const senateSemicircle = await screen.findByLabelText(
      'Senate post-election composition semicircle',
    );
    expect(screen.getByText('34 of 100 seats contested')).toBeInTheDocument();
    expect(
      screen.getByText('Seats decided in this renewal'),
    ).toBeInTheDocument();
    expect(
      senateSemicircle.querySelector(
        '[data-party-segment="us-republican_party"]',
      ),
    ).not.toBeNull();
    expect(
      screen.getAllByText(
        'This is the full chamber immediately after the latest election or renewal reported by IPU. It is not necessarily the current composition.',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('shows IPU attribution, licence, and terms in the source index', async () => {
    useWorkspaceStore.setState({ activeTab: 'sources' });
    renderPanel();

    expect(
      await screen.findByText(
        'Inter-Parliamentary Union: Parline, September 2026',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Terms of use/ })).toHaveAttribute(
      'href',
      'https://www.ipu.org/terms-use',
    );
  });

  it.each([
    {
      entityId: 'state:m49:840',
      m49: '840',
      name: 'United States',
      profile: usaProfile,
      person: 'Donald Trump',
      since: '2025-01-20',
    },
    {
      entityId: 'state:m49:360',
      m49: '360',
      name: 'Indonesia',
      profile: indonesiaProfile,
      person: 'Prabowo Subianto',
      since: '2024-10-20',
    },
  ])(
    'renders a president who is both head of state and head of government once for $name',
    async ({ entityId, m49, name, profile, person, since }) => {
      selectProfile({ entityId, m49, name, profile });
      renderPanel();

      expect(await screen.findAllByText(person)).toHaveLength(1);
      expect(
        screen.getByText('Head of government · Head of state'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(`President · Since ${since}`),
      ).toBeInTheDocument();
    },
  );

  it('keeps genuinely separate head-of-state and head-of-government cards', async () => {
    selectProfile({
      entityId: 'state:m49:392',
      m49: '392',
      name: 'Japan',
      profile: japanProfile,
    });
    renderPanel();

    expect(await screen.findByText('Sanae Takaichi')).toBeInTheDocument();
    expect(screen.getByText('Naruhito')).toBeInTheDocument();
    expect(screen.getByText('Head of government')).toBeInTheDocument();
    expect(screen.getByText('Head of state')).toBeInTheDocument();
    expect(screen.queryByText('Head of government · Head of state')).toBeNull();
  });

  it('uses durable copy for countries without a validated profile', () => {
    useWorkspaceStore.setState({
      selectedEntityId: 'state:m49:578',
      selectedM49: '578',
      selectedName: 'Norway',
      activeTab: 'overview',
    });

    renderPanel();

    expect(
      screen.getByText(
        'A verified profile is not yet available for this country. Map selection still works globally.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Australia is the first validated demonstration profile/,
      ),
    ).toBeNull();
  });
});
