"""docs/index.html = head + body + fzstd (MIT, inline) + app.js"""
import os
H = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(H, '..', 'docs')
r = lambda p: open(p, encoding='utf-8').read()
open(os.path.join(D, 'index.html'), 'w', encoding='utf-8').write(
    r(os.path.join(D, 'head.html')) + r(os.path.join(D, 'body.html'))
    + '<script>/* fzstd 0.1.1, MIT, (c) 2020 Arjun Barrett */\n' + r(os.path.join(H, 'fzstd.umd.js'))
    + '\n</script>\n<script>\n' + r(os.path.join(D, 'app.js')) + '</script>\n</body>\n</html>\n')
