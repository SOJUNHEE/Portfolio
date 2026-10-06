'use strict';
const toggle = document.querySelector('.menu-toggle');
const nav = document.getElementById('main-nav');
const main = document.getElementById('main');
const footer = document.querySelector('.site-footer');
const outsideMenu = [document.querySelector('.skip-link'), document.querySelector('.logo')].filter(Boolean);
const media = window.matchMedia('(max-width: 767px)');
function setMenu(open, restoreFocus = false) {
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    if (main) main.inert = open;
    if (footer) footer.inert = open;
    outsideMenu.forEach(el => { el.inert = open; });
    if (restoreFocus) toggle.focus();
}
if (toggle && nav) {
    toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', event => {
        if (event.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', event => {
        if (toggle.getAttribute('aria-expanded') !== 'true') return;
        if (event.key === 'Escape') { setMenu(false, true); return; }
        if (event.key === 'Tab') {
            const focusable = [toggle, ...nav.querySelectorAll('a')];
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    const onMediaChange = () => { if (!media.matches) setMenu(false); };
    if (media.addEventListener) media.addEventListener('change', onMediaChange);
    else media.addListener(onMediaChange);  // Safari 13 and older
}
// Marks the link for the section currently in view (header menu on home, step list on detail pages).
function trackCurrent(targets, links) {
    if (!('IntersectionObserver' in window) || !targets.length || !links.length) return;
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            links.forEach(link => {
                if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
                else link.removeAttribute('aria-current');
            });
        });
    }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
    targets.forEach(target => observer.observe(target));
}
if (nav) trackCurrent(document.querySelectorAll('main > section[id]'), nav.querySelectorAll('a'));
trackCurrent(document.querySelectorAll('.detail-content section[id]'), document.querySelectorAll('.detail-steps a'));
const copyButton = document.querySelector('.copy-email');
if (copyButton) copyButton.addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(copyButton.dataset.email);
        status.textContent = '이메일 주소를 복사했습니다.';
    } catch {
        status.textContent = '주소를 선택해 복사하거나 이메일 링크를 이용해 주세요.';
    }
});
// Reveal is opt-in: content stays visible unless this script can safely hide and later show it.
const revealEls = document.querySelectorAll('.reveal');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if (revealEls.length && 'IntersectionObserver' in window && !reducedMotion.matches) {
    const show = el => el.classList.remove('reveal-pending');
    const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            show(entry.target);
            revealObserver.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(el => {
        if (el.getBoundingClientRect().top < window.innerHeight) return;
        el.classList.add('reveal-pending');
        revealObserver.observe(el);
    });
    const showAll = () => { revealEls.forEach(show); revealObserver.disconnect(); };
    window.addEventListener('beforeprint', showAll);
    const onMotionChange = () => { if (reducedMotion.matches) showAll(); };
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);
    else reducedMotion.addListener(onMotionChange);
}
// Corrupt images also receive a readable fallback, beyond server-side existence checks.
document.querySelectorAll('.hero-work-media img, .project-preview img, .detail-preview img, .gallery img').forEach(img => {
    const fallback = () => {
        const placeholder = document.createElement('span');
        placeholder.className = 'image-placeholder';
        const label = document.createElement('small');
        label.textContent = 'Project Preview';
        placeholder.append(label);
        if (img.dataset.title) {
            const title = document.createElement('strong');
            title.textContent = img.dataset.title;
            placeholder.append(title);
        }
        img.replaceWith(placeholder);
    };
    img.addEventListener('error', fallback, { once: true });
    if (img.complete && img.naturalWidth === 0) fallback();
});
