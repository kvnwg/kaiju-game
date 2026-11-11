// Panels in frames too short for them (a phone on its side with the browser's bars showing, a
// small preview window): rather than scroll or run off the screen, the panel is drawn smaller. It
// is laid out wider by the same factor, so it keeps its width on screen and only gets as small as
// the height needs. Past `min` it scrolls as before (long lists would get too small to read).
export const MIN_FIT = 0.5;

// `box` must fit inside its parent (the parent's padding kept clear). `align` places it in the
// parent's height once shrunk: 'center', or 'end' for the bottom.
export function fitBox(box, align = 'center', min = MIN_FIT) {
  const room = box.parentElement;
  const st = box.style;
  const reset = () => {
    st.width = st.maxWidth = st.maxHeight = st.flexShrink = st.scale = st.translate = st.transformOrigin = '';
  };
  reset();
  room.classList.remove('fitted');
  const cs = getComputedStyle(room);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const roomH = room.clientHeight - padTop - padBottom;
  const w = box.offsetWidth;
  // (A panel that caps its own height and scrolls inside is measured at its full height.)
  st.maxHeight = 'none';
  if (!w || roomH <= 0 || box.offsetHeight <= roomH) {
    reset();
    return;
  }
  // Laid out at w / f and drawn at f, the box is w wide on screen; how tall is it then?
  st.maxWidth = 'none';
  st.flexShrink = '0';
  const heightAt = (f) => {
    st.width = `${w / f}px`;
    return box.offsetHeight * f;
  };
  if (heightAt(min) > roomH) {
    reset();
    return;
  }
  let lo = min;
  let hi = 1;
  for (let i = 0; i < 7; i++) {
    const f = (lo + hi) / 2;
    if (heightAt(f) <= roomH) lo = f;
    else hi = f;
  }
  const h = heightAt(lo);
  room.scrollTop = 0;
  room.scrollLeft = 0;
  const top = align === 'end' ? room.clientHeight - padBottom - h : (room.clientHeight - h) / 2;
  st.transformOrigin = '0 0';
  st.scale = String(lo);
  st.translate = `${(room.clientWidth - w) / 2 - box.offsetLeft}px ${top - box.offsetTop}px`;
  room.classList.add('fitted');
}
