using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace FigBoost.UI
{
    // Keep Button's native click, dialog, keyboard and accessibility behaviour.
    public class ActionButton : Button
    {
        private readonly Timer animation = new Timer { Interval = 15 };
        private readonly Stopwatch clock = new Stopwatch();
        private readonly Color accent = Color.FromArgb(37, 99, 235);
        private Color border;
        private bool hover, mouseDown, keyDown, primary, disposed;
        private double hoverAmount, pressAmount, fromHover, fromPress, toHover, toPress;
        private int duration;
        [DllImport("user32.dll")]
        private static extern bool SystemParametersInfo(uint action, uint parameter, out bool value, uint flags);

        public ActionButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            UseVisualStyleBackColor = false;
            Cursor = Cursors.Hand;
            animation.Tick += Animate;
        }

        public void Configure(Color background, Color foreground, Color outline)
        {
            primary = outline.A == 0;
            BackColor = background;
            ForeColor = foreground;
            border = primary ? background : outline;
            Invalidate();
        }

        private void Transition()
        {
            if (disposed) return;
            fromHover = hoverAmount;
            fromPress = pressAmount;
            toHover = Enabled && hover ? 1 : 0;
            toPress = Enabled && ((mouseDown && hover) || keyDown) ? 1 : 0;
            duration = toPress > 0 ? 80 : 140;
            bool clientAnimations;
            bool reducedMotion = SystemParametersInfo(0x1042 /* SPI_GETCLIENTAREAANIMATION */, 0, out clientAnimations, 0) && !clientAnimations;
            if (!Enabled || !Visible || reducedMotion || SystemInformation.HighContrast || !SystemInformation.UIEffectsEnabled)
            {
                animation.Stop();
                hoverAmount = toHover;
                pressAmount = toPress;
            }
            else if (fromHover != toHover || fromPress != toPress)
            {
                clock.Restart();
                animation.Start();
            }
            Invalidate();
        }

        private void Animate(object sender, EventArgs e)
        {
            double progress = Math.Min(1, clock.Elapsed.TotalMilliseconds / duration);
            double eased = 1 - Math.Pow(1 - progress, 3);
            hoverAmount = fromHover + (toHover - fromHover) * eased;
            pressAmount = fromPress + (toPress - fromPress) * eased;
            if (progress >= 1) animation.Stop();
            Invalidate();
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Transition(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Transition(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left) { mouseDown = true; Transition(); }
            base.OnMouseDown(e);
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left) { mouseDown = false; Transition(); }
            base.OnMouseUp(e);
        }
        protected override void OnMouseCaptureChanged(EventArgs e)
        {
            if (!Capture) { mouseDown = false; Transition(); }
            base.OnMouseCaptureChanged(e);
        }
        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Space && e.Modifiers == Keys.None && !keyDown) { keyDown = true; Transition(); }
            base.OnKeyDown(e);
        }
        protected override void OnKeyUp(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Space) { keyDown = false; Transition(); }
            base.OnKeyUp(e);
        }
        protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
        protected override void OnLostFocus(EventArgs e) { keyDown = false; Transition(); base.OnLostFocus(e); }
        protected override void OnEnabledChanged(EventArgs e)
        {
            if (!Enabled) { mouseDown = keyDown = false; }
            Transition();
            base.OnEnabledChanged(e);
        }
        protected override void OnVisibleChanged(EventArgs e)
        {
            if (!Visible) { hover = mouseDown = keyDown = false; }
            Transition();
            base.OnVisibleChanged(e);
        }
        protected override void OnClick(EventArgs e)
        {
            // Paint the feedback before a click opens a modal or starts synchronous work.
            if (Enabled) { pressAmount = 1; Transition(); Update(); }
            base.OnClick(e);
        }

        private static Color Mix(Color a, Color b, double amount)
        {
            return Color.FromArgb((int)(a.R + (b.R - a.R) * amount),
                (int)(a.G + (b.G - a.G) * amount), (int)(a.B + (b.B - a.B) * amount));
        }
        internal static GraphicsPath Rounded(RectangleF rect, float radius)
        {
            var path = new GraphicsPath();
            float diameter = radius * 2;
            path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }
        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent == null ? SystemColors.Control : Parent.BackColor);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            if (SystemInformation.HighContrast) { base.OnPaint(e); return; }
            if (Width < 16 || Height < 16) return;
            OnPaintBackground(e);
            float scale = e.Graphics.DpiX / 96f;
            float inset = (float)(1 + pressAmount * 0.6) * scale;
            var rect = new RectangleF(inset, inset, Width - 2 * inset - 1, Height - 2 * inset - 1);
            Color fill = primary ? Mix(BackColor, Color.Black, hoverAmount * 0.06 + pressAmount * 0.12)
                : Mix(Mix(BackColor, Color.FromArgb(241, 245, 249), hoverAmount), Color.FromArgb(226, 232, 240), pressAmount);
            Color outline = Mix(border, Color.FromArgb(148, 163, 184), Math.Max(hoverAmount, pressAmount));
            Color text = ForeColor;
            if (!Enabled) { fill = Color.FromArgb(241, 245, 249); outline = Color.FromArgb(226, 232, 240); text = Color.FromArgb(148, 163, 184); }
            bool keyboardFocus = Focused && ShowFocusCues && Enabled;
            if (keyboardFocus) outline = primary ? Color.FromArgb(147, 197, 253) : accent;
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Rounded(rect, 6 * scale))
            using (var brush = new SolidBrush(fill))
            using (var pen = new Pen(outline, (keyboardFocus ? 2 : 1) * scale))
            {
                e.Graphics.FillPath(brush, path);
                // Keyboard focus strengthens the existing outline instead of adding a second frame.
                if (!primary || !Enabled || keyboardFocus) e.Graphics.DrawPath(pen, path);
            }
            var textRect = ClientRectangle;
            textRect.Offset(0, (int)Math.Round(pressAmount * scale));
            var flags = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
            if (!ShowKeyboardCues) flags |= TextFormatFlags.HidePrefix;
            TextRenderer.DrawText(e.Graphics, Text, Font, textRect, text, flags);
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { disposed = true; animation.Dispose(); }
            base.Dispose(disposing);
        }
    }

    // Small status glyph with a full button hit area and native keyboard access.
    public class UpdateIndicatorButton : Button
    {
        public UpdateIndicatorButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            Cursor = Cursors.Hand;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent == null ? SystemColors.Control : Parent.BackColor);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float size = Math.Min(Width, Height) * 0.56f;
            float x = (Width - size) / 2, y = (Height - size) / 2;
            Color green = SystemInformation.HighContrast ? SystemColors.Highlight : Color.FromArgb(35, 215, 53);
            using (var fill = new SolidBrush(green)) e.Graphics.FillEllipse(fill, x, y, size, size);
            using (var pen = new Pen(SystemInformation.HighContrast ? SystemColors.HighlightText : Color.White, size * 0.09f))
            {
                pen.StartCap = pen.EndCap = LineCap.Round;
                e.Graphics.DrawLine(pen, x + size / 2, y + size * 0.72f, x + size / 2, y + size * 0.28f);
                e.Graphics.DrawLines(pen, new[] { new PointF(x + size * 0.31f, y + size * 0.47f),
                    new PointF(x + size / 2, y + size * 0.28f), new PointF(x + size * 0.69f, y + size * 0.47f) });
            }
            if (Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle, -2, -2), Color.White, BackColor);
        }
    }

    // Paint the read-only path surface without a native square window border.
    public class PathPanel : Panel
    {
        public PathPanel()
        {
            BorderStyle = BorderStyle.None;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent == null ? SystemColors.Control : Parent.BackColor);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Width < 16 || Height < 16) return;
            OnPaintBackground(e);
            float scale = e.Graphics.DpiX / 96f;
            var rect = new RectangleF(scale / 2, scale / 2, Width - scale, Height - scale);
            Color outline = SystemInformation.HighContrast ? SystemColors.WindowText : Color.FromArgb(209, 217, 227);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = ActionButton.Rounded(rect, 6 * scale))
            using (var brush = new SolidBrush(BackColor))
            using (var pen = new Pen(outline, scale))
            {
                e.Graphics.FillPath(brush, path);
                e.Graphics.DrawPath(pen, path);
            }
            base.OnPaint(e);
        }
    }
}
