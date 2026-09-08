import { h } from './components.js';

export const title = 'Мишень';

export async function mount(root) {
  root.appendChild(h('div', { class: 'empty' }, 'Раздел в разработке'));
}
