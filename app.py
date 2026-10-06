"""소준희 포트폴리오 — JSON을 수정하면 다음 요청부터 반영됩니다."""
import json
import logging
import os
import re
import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit
from flask import Flask, abort, g, redirect, render_template, request, send_from_directory, url_for

app = Flask(__name__)
app.config['DATA_DIR'] = Path(__file__).parent / 'data'
app.config['DEMO_DIR'] = Path(__file__).parent / 'demos'  # outside static/: served only through /demo/<slug>/
SLUG = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')


def load_json(name, default):
    """Fixed internal filenames only; cache once per request."""
    cache = g.setdefault('portfolio_data', {})
    if name not in cache:
        try:
            value = json.loads((Path(app.config['DATA_DIR']) / name).read_text(encoding='utf-8-sig'))
            cache[name] = value if isinstance(value, type(default)) else default
        except (OSError, ValueError, UnicodeError):
            app.logger.warning('Could not load portfolio data: %s', name)
            cache[name] = default
    return cache[name]


def get_profile():
    fallback = {'name': '소준희', 'english_name': 'SO JUN HEE',
                'email': 'sojh90@naver.com', 'location': 'Seoul, Republic of Korea',
                'metrics': [], 'competencies': [], 'skills': [], 'certifications': []}
    raw = load_json('profile.json', {})
    for key, value in raw.items():
        if key in fallback and not isinstance(value, type(fallback[key])):
            continue
        fallback[key] = value
    # Keep only well-formed list entries so a malformed profile.json cannot break the home page.
    text = lambda v: v if isinstance(v, str) else ''
    fallback['skills'] = [{'category': text(s.get('category')), 'state': text(s.get('state')), 'items': text_list(s.get('items'))}
                          for s in fallback['skills'] if isinstance(s, dict)]
    fallback['competencies'] = [{'title': text(c.get('title')), 'subtitle': text(c.get('subtitle')), 'items': text_list(c.get('items'))}
                                for c in fallback['competencies'] if isinstance(c, dict)]
    fallback['metrics'] = [{k: text(m.get(k)) for k in ('value', 'label', 'source')} for m in fallback['metrics'] if isinstance(m, dict)]
    fallback['certifications'] = text_list(fallback['certifications'])
    return fallback


def text_list(value):
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [v for v in value if isinstance(v, str) and v.strip()] if isinstance(value, list) else []


def get_experiences():
    result = []
    for raw in load_json('experiences.json', []):
        if not isinstance(raw, dict):
            continue
        item = {key: raw.get(key, '') for key in ('company', 'period', 'department', 'position', 'environment', 'scale')}
        for key in ('roles', 'achievements', 'tools'):
            item[key] = text_list(raw.get(key))
        result.append(item)
    return result


def safe_url(value):
    if not isinstance(value, str) or any(ord(c) < 33 for c in value) or '\\' in value:
        return ''
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme in ('https', 'http') and parsed.hostname and not parsed.username and not parsed.password else ''
    except ValueError:
        return ''


DEMO_URL = re.compile(r'^/demo/([a-z0-9]+(?:-[a-z0-9]+)*)/$')


def demo_url(value):
    """Internal demo path like /demo/<slug>/ — only when demos/<slug>/index.html exists."""
    match = DEMO_URL.fullmatch(value) if isinstance(value, str) else None
    return value if match and (Path(app.config['DEMO_DIR']) / match.group(1) / 'index.html').is_file() else ''


def project_image(value):
    """Only existing local raster images confined to static/images/projects."""
    if not isinstance(value, str) or '\\' in value:
        return ''
    root = (Path(app.static_folder) / 'images' / 'projects').resolve()
    path = (Path(app.static_folder) / value).resolve()
    if not path.is_relative_to(root) or path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'):
        return ''
    return url_for('static', filename=value) if path.is_file() else ''


def get_projects():
    result, seen = [], set()
    for raw in load_json('projects.json', []):
        if not isinstance(raw, dict) or raw.get('is_published') is not True:
            continue
        slug = raw.get('slug', '')
        if not isinstance(slug, str) or not SLUG.fullmatch(slug) or slug in seen:
            continue
        seen.add(slug)
        item = {'slug': slug, 'id': raw.get('id', slug)}
        for key in ('title', 'program', 'description', 'status', 'period', 'role'):
            item[key] = raw.get(key) if isinstance(raw.get(key), str) else ''
        item['title'] = item['title'] or '프로젝트'
        item['status'] = item['status'] or 'Project'
        for key in ('problem', 'objective', 'data', 'solution', 'architecture', 'features', 'tech_stack', 'result', 'future_improvement',
                    'my_contribution', 'team_contribution'):
            item[key] = text_list(raw.get(key))
        # Optional display-only summaries; older entries without them fall back to existing fields.
        for key, default in (('card_summary', item['description']), ('card_label', item['program']),
                             ('card_role', item['role'] if len(item['role']) <= 80 else '')):
            value = raw.get(key)
            item[key] = value.strip() if isinstance(value, str) and value.strip() else default
        for key in ('github_url', 'live_url', 'external_url'):
            item[key] = safe_url(raw.get(key))
        item['live_url'] = item['live_url'] or demo_url(raw.get('live_url'))
        item['thumbnail'] = project_image(raw.get('thumbnail'))
        item['gallery'] = []
        for entry in raw.get('gallery', []) if isinstance(raw.get('gallery'), list) else []:
            entry = {'src': entry, 'alt': item['title']} if isinstance(entry, str) else entry
            if isinstance(entry, dict):
                src = project_image(entry.get('src'))
                if src:
                    item['gallery'].append({'src': src, 'alt': entry.get('alt') or item['title']})
        item['is_featured'] = raw.get('is_featured') is True  # 홈 Hero 대표 프로젝트(없으면 정렬상 첫 프로젝트)
        order = raw.get('sort_order', 999)
        item['sort_order'] = order if isinstance(order, (int, float)) and not isinstance(order, bool) else 999
        result.append(item)
    return sorted(result, key=lambda p: (p['sort_order'], p['slug']))


def get_project_by_slug(slug):
    if not SLUG.fullmatch(slug):
        return None
    return next((p for p in get_projects() if p['slug'] == slug), None)


def site_root():
    """Public origin for link-preview tags. Render/Cloudflare terminate TLS, so the first X-Forwarded-Proto
    value is the scheme the visitor used; it only affects these absolute preview URLs."""
    proto = request.headers.get('X-Forwarded-Proto', '').split(',')[0].strip()
    return f"{'https' if proto == 'https' or request.is_secure else request.scheme}://{request.host}"


@app.context_processor
def shared_context():
    return {'profile': get_profile(), 'site_root': site_root}


@app.route('/')
def index():
    return render_template('index.html', experiences=get_experiences(), projects=get_projects())


@app.route('/projects/<slug>')
def project_detail(slug):
    project = get_project_by_slug(slug)
    if project is None:
        abort(404)
    return render_template('project_detail.html', project=project)


@app.route('/privacy')
def privacy():
    return render_template('privacy.html')


@app.route('/robots.txt')
def robots():
    # Public portfolio: allow all crawlers and link-preview fetchers.
    return app.response_class('User-agent: *\nAllow: /\n', mimetype='text/plain')


@app.route('/demo/<slug>/')
@app.route('/demo/<slug>/<path:filename>')
def demo(slug, filename='index.html'):
    """Project demos bundled under demos/<slug>/, served only while a published project links to them
    (send_from_directory blocks path traversal)."""
    if not SLUG.fullmatch(slug) or not any(p['live_url'] == f'/demo/{slug}/' for p in get_projects()):
        abort(404)
    return send_from_directory(Path(app.config['DEMO_DIR']) / slug, filename)


@app.route('/sub1')
@app.route('/sub1/detail/<category>')
def legacy_projects(category=None):
    return redirect(url_for('index', _anchor='projects'), code=301)


@app.route('/sub2')
def legacy_about():
    return redirect(url_for('index', _anchor='about'), code=301)


@app.route('/sub3')
def legacy_journey():
    return redirect(url_for('index', _anchor='journey'), code=301)


@app.route('/sub4')
def legacy_experience():
    return redirect(url_for('index', _anchor='experience'), code=301)


@app.errorhandler(404)
def not_found(error):
    return render_template('404.html'), 404


@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; img-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'"
    if request.path.startswith('/demo/'):
        # Bundled demo renders style="" attributes from its own scripts; scripts stay 'self'-only.
        response.headers['Content-Security-Policy'] = response.headers['Content-Security-Policy'].replace(
            "style-src 'self'", "style-src 'self' 'unsafe-inline'").replace("img-src 'self'", "img-src 'self' data: blob:")
    return response


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    port = int(os.environ.get('PORT', '5000'))
    debug = False
    if not debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        threading.Timer(1, lambda: webbrowser.open(f'http://127.0.0.1:{port}/')).start()
    app.run(host='127.0.0.1', port=port, debug=debug)
