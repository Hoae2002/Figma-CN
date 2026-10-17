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
        protected double HoverAmount { get { return hoverAmount; } }
        protected double PressAmount { get { return pressAmount; } }
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
    public class UpdateIndicatorButton : ActionButton
    {
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent == null ? SystemColors.Control : Parent.BackColor);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float diameter = Math.Min(Width, Height);
            float size = diameter * 0.55f * (float)(1 + HoverAmount * 0.08 - PressAmount * 0.12);
            float x = (Width - size) / 2, y = (Height - size) / 2;
            Color green = SystemInformation.HighContrast ? SystemColors.Highlight : Color.FromArgb(35, 215, 53);
            if (!Enabled) green = SystemColors.GrayText;
            if (Enabled && HoverAmount > 0 && !SystemInformation.HighContrast)
            {
                float halo = diameter * 0.88f;
                using (var glow = new SolidBrush(Color.FromArgb((int)(38 * HoverAmount), green)))
                    e.Graphics.FillEllipse(glow, (Width - halo) / 2, (Height - halo) / 2, halo, halo);
            }
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

    public class GitHubButton : ActionButton
    {
        protected override void OnPaint(PaintEventArgs e)
        {
            Color background = Parent == null ? SystemColors.Control : Parent.BackColor;
            e.Graphics.Clear(background);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float size = Math.Min(Width, Height) * 0.55f * (float)(1 + HoverAmount * 0.08 - PressAmount * 0.12);
            var state = e.Graphics.Save();
            e.Graphics.TranslateTransform((Width - size) / 2, (Height - size) / 2);
            e.Graphics.ScaleTransform(size / 24f, size / 24f);
            // GitHub's circular cat mark, drawn as vectors for crisp DPI scaling.
            using (var path = new GraphicsPath())
            using (var fill = new SolidBrush(!Enabled ? SystemColors.GrayText : SystemInformation.HighContrast ? SystemColors.WindowText : Color.White))
            {
                path.AddBezier(12, 0, 5.37f, 0, 0, 5.37f, 0, 12);
                path.AddBezier(0, 12, 0, 17.3f, 3.44f, 21.8f, 8.2f, 23.39f);
                path.AddBezier(8.2f, 23.39f, 8.8f, 23.5f, 9.02f, 23.13f, 9.02f, 22.81f);
                path.AddLine(9.02f, 22.81f, 9.02f, 20.58f);
                path.AddBezier(9.02f, 20.58f, 5.68f, 21.31f, 4.98f, 19.16f, 4.98f, 19.16f);
                path.AddBezier(4.98f, 19.16f, 4.44f, 17.77f, 3.65f, 17.4f, 3.65f, 17.4f);
                path.AddBezier(3.65f, 17.4f, 2.56f, 16.65f, 3.73f, 16.67f, 3.73f, 16.67f);
                path.AddBezier(3.73f, 16.67f, 4.94f, 16.75f, 5.57f, 17.91f, 5.57f, 17.91f);
                path.AddBezier(5.57f, 17.91f, 6.64f, 19.75f, 8.38f, 19.22f, 9.06f, 18.91f);
                path.AddBezier(9.06f, 18.91f, 9.17f, 18.13f, 9.48f, 17.59f, 9.82f, 17.29f);
                path.AddBezier(9.82f, 17.29f, 7.15f, 16.99f, 4.34f, 15.95f, 4.34f, 11.35f);
                path.AddBezier(4.34f, 11.35f, 4.34f, 10.04f, 4.81f, 8.97f, 5.57f, 8.13f);
                path.AddBezier(5.57f, 8.13f, 5.45f, 7.82f, 5.03f, 6.6f, 5.69f, 4.95f);
                path.AddBezier(5.69f, 4.95f, 5.69f, 4.95f, 6.7f, 4.63f, 8.99f, 6.18f);
                path.AddBezier(8.99f, 6.18f, 10.9f, 5.65f, 13.1f, 5.65f, 15.01f, 6.18f);
                path.AddBezier(15.01f, 6.18f, 17.3f, 4.63f, 18.31f, 4.95f, 18.31f, 4.95f);
                path.AddBezier(18.31f, 4.95f, 18.97f, 6.6f, 18.55f, 7.82f, 18.43f, 8.13f);
                path.AddBezier(18.43f, 8.13f, 19.19f, 8.97f, 19.66f, 10.04f, 19.66f, 11.35f);
                path.AddBezier(19.66f, 11.35f, 19.66f, 15.96f, 16.85f, 16.99f, 14.17f, 17.29f);
                path.AddBezier(14.17f, 17.29f, 14.6f, 17.66f, 14.98f, 18.39f, 14.98f, 19.51f);
                path.AddLine(14.98f, 19.51f, 14.98f, 22.81f);
                path.AddBezier(14.98f, 22.81f, 14.98f, 23.13f, 15.2f, 23.5f, 15.8f, 23.39f);
                path.AddBezier(15.8f, 23.39f, 20.56f, 21.8f, 24, 17.3f, 24, 12);
                path.AddBezier(24, 12, 24, 5.37f, 18.63f, 0, 12, 0);
                path.CloseFigure();
                e.Graphics.FillPath(fill, path);
            }
            e.Graphics.Restore(state);
            if (Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle, -2, -2), Color.White, background);
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
