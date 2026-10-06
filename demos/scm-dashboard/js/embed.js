/* 포트폴리오 사이트 내장본 전용: 원본의 인라인 onsubmit="return false"를 대신한다(CSP가 인라인 스크립트를 막기 때문). */
document.addEventListener('submit', function (event) {
  if (event.target && event.target.id === 'filters') event.preventDefault();
});
