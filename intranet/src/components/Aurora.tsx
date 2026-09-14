// Фиксированный фон: четыре размытых пятна поверх черного. Не анимируется
export function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="a1" />
      <span className="a2" />
      <span className="a3" />
      <span className="a4" />
    </div>
  )
}
