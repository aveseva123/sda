import { h } from './components.js';

export const title = 'Тест';

export async function mount(root) {
  root.appendChild(h('div', { class: 'empty' }, 'Раздел в разработке'));
}
