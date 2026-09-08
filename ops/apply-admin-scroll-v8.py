from pathlib import Path

index = Path('admin/index.html')
css = Path('admin/v5.css')

h = index.read_text(encoding='utf-8')
c = css.read_text(encoding='utf-8')

# Force Android WebView/browser cache to pick the corrected stylesheet.
h = h.replace('./v5.css?v=500', './v5.css?v=800')
h = h.replace('./v5.css?v=700', './v5.css?v=800')

marker = '/* GAME_ZONE_ADMIN_SCROLL_V8 */'
if marker not in c:
    c += r'''

/* GAME_ZONE_ADMIN_SCROLL_V8 */
@media (max-width:700px){
  html{
    height:auto!important;
    min-height:100%!important;
    max-height:none!important;
    overflow-x:hidden!important;
    overflow-y:auto!important;
    overscroll-behavior-y:auto!important;
    touch-action:pan-y!important;
    -webkit-overflow-scrolling:touch!important;
  }
  body.gz-admin-v3{
    position:relative!important;
    height:auto!important;
    min-height:100dvh!important;
    max-height:none!important;
    overflow-x:hidden!important;
    overflow-y:visible!important;
    overscroll-behavior-y:auto!important;
    touch-action:pan-y!important;
    -webkit-overflow-scrolling:touch!important;
  }
  body.gz-admin-v3 .layout{
    position:relative!important;
    height:auto!important;
    min-height:100dvh!important;
    max-height:none!important;
    overflow:visible!important;
    touch-action:pan-y!important;
  }
  body.gz-admin-v3 main{
    position:relative!important;
    height:auto!important;
    min-height:100dvh!important;
    max-height:none!important;
    overflow:visible!important;
    padding-bottom:calc(132px + var(--gz5-safe-bottom))!important;
    touch-action:pan-y!important;
  }
  body.gz-admin-v3 .page,
  body.gz-admin-v3 .page.active{
    position:relative!important;
    height:auto!important;
    min-height:0!important;
    max-height:none!important;
    overflow:visible!important;
    touch-action:pan-y!important;
  }
  body.gz-admin-v3 .page.active{
    display:block!important;
    padding-bottom:24px!important;
  }
  body.gz-admin-v3 .page>.panel:last-child,
  body.gz-admin-v3 .page>.gz3-hub:last-child,
  body.gz-admin-v3 .page>.gz3-more-list:last-child{
    margin-bottom:24px!important;
  }

  /* Keep fixed controls outside the document flow but never let them steal vertical swipes. */
  body.gz-admin-v3 .gz-owner-topbar,
  body.gz-admin-v3 .gz-bottom-nav{
    touch-action:manipulation!important;
  }
  body.gz-admin-v3 .gz-drawer-shade{
    touch-action:none!important;
  }
  body.gz-admin-v3 aside{
    overflow-x:hidden!important;
    overflow-y:auto!important;
    overscroll-behavior:contain!important;
    -webkit-overflow-scrolling:touch!important;
    touch-action:pan-y!important;
  }
  body.gz-admin-v3 .gz-quick-sheet{
    max-height:calc(100dvh - 122px - var(--gz5-safe-bottom))!important;
    overflow-x:hidden!important;
    overflow-y:auto!important;
    overscroll-behavior:contain!important;
    -webkit-overflow-scrolling:touch!important;
    touch-action:pan-y!important;
  }
  body.gz-admin-v3 .modal.show{
    align-items:flex-start!important;
    overflow-x:hidden!important;
    overflow-y:auto!important;
    overscroll-behavior:contain!important;
    -webkit-overflow-scrolling:touch!important;
    touch-action:pan-y!important;
  }
  body.gz-admin-v3 .modal-card{
    width:min(560px,100%)!important;
    max-height:none!important;
    margin:auto 0!important;
    overflow:visible!important;
    touch-action:pan-y!important;
  }

  /* Tables/cards may scroll sideways, while the page always keeps vertical scrolling. */
  body.gz-admin-v3 .table-wrap:not(.gz-mobile-cards){
    overflow-x:auto!important;
    overflow-y:visible!important;
    overscroll-behavior-x:contain!important;
    touch-action:pan-x pan-y!important;
    -webkit-overflow-scrolling:touch!important;
  }
  body.gz-admin-v3 .table-wrap.gz-mobile-cards{
    overflow:visible!important;
    touch-action:pan-y!important;
  }

  /* Ensure the fixed bottom navigation never covers the last actionable content. */
  body.gz-admin-v3::after{
    content:'';
    display:block;
    height:calc(32px + var(--gz5-safe-bottom));
    pointer-events:none;
  }
}
'''

index.write_text(h, encoding='utf-8')
css.write_text(c, encoding='utf-8')
