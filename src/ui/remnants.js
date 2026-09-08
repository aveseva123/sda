import { h } from './components.js';

export const title = 'Остатки';

export async function mount(root) {
  root.appendChild(h('div', { class: 'empty' }, 'Раздел в разработке'));
}
