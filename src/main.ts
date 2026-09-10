/**
 * LumaLink Application Coordinator & Router
 */

import { SenderApp } from './apps/sender/sender-ui';
import { ReceiverApp } from './apps/receiver/receiver-ui';
import { DiagnosticsApp } from './apps/benchmark/diagnostics-ui';

class AppCoordinator {
  private appRoot: HTMLElement;
  private senderContainer!: HTMLElement;
  private receiverContainer!: HTMLElement;
  private benchmarkContainer!: HTMLElement;

  private senderApp!: SenderApp;
  private receiverApp!: ReceiverApp;
  private diagnosticsApp!: DiagnosticsApp;

  private currentTab = 'sender';

  constructor() {
    this.appRoot = document.getElementById('app-root') as HTMLElement;
    this.initViews();
    this.bindNavigation();
    this.handleRoute();
  }

  private initViews(): void {
    // 1. Create container containers
    this.senderContainer = document.createElement('div');
    this.senderContainer.id = 'view-sender';

    this.receiverContainer = document.createElement('div');
    this.receiverContainer.id = 'view-receiver';
    this.receiverContainer.style.display = 'none';

    this.benchmarkContainer = document.createElement('div');
    this.benchmarkContainer.id = 'view-benchmark';
    this.benchmarkContainer.style.display = 'none';

    this.appRoot.appendChild(this.senderContainer);
    this.appRoot.appendChild(this.receiverContainer);
    this.appRoot.appendChild(this.benchmarkContainer);

    // 2. Instantiate and render apps
    this.senderApp = new SenderApp(this.senderContainer);
    this.senderApp.render();

    this.receiverApp = new ReceiverApp(this.receiverContainer);
    this.receiverApp.render();

    this.diagnosticsApp = new DiagnosticsApp(
      this.benchmarkContainer,
      this.senderApp,
      this.receiverApp
    );
    this.diagnosticsApp.render();
  }

  private bindNavigation(): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target') || 'sender';
        this.switchTab(target);
        window.location.hash = target;
      });
    });

    window.addEventListener('hashchange', () => this.handleRoute());
  }

  private handleRoute(): void {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (hash === 'receiver' || hash === 'receive') {
      this.switchTab('receiver');
      // Automatically attempt rear camera start on mobile when navigating directly to /#receiver
      this.receiverApp.startCamera().catch(() => {});
    } else if (hash === 'benchmark' || hash === 'sim') {
      this.switchTab('benchmark');
    } else {
      this.switchTab('sender');
    }
  }

  private switchTab(tab: string): void {
    this.currentTab = tab;

    // Update buttons
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      if (btn.getAttribute('data-target') === tab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Toggle view visibility
    this.senderContainer.style.display = tab === 'sender' ? 'block' : 'none';
    this.receiverContainer.style.display = tab === 'receiver' ? 'block' : 'none';
    this.benchmarkContainer.style.display = tab === 'benchmark' ? 'block' : 'none';

    if (tab === 'receiver') {
      // If receiver became visible, trigger redraw if needed
    }
  }

  public getCurrentTab(): string {
    return this.currentTab;
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new AppCoordinator();
});
