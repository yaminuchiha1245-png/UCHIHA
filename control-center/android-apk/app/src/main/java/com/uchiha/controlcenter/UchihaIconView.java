package com.uchiha.controlcenter;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.View;

public final class UchihaIconView extends View {
    public static final int BRAND = 0;
    public static final int PROJECT = 1;
    public static final int AI = 2;
    public static final int PREVIEW = 3;
    public static final int SOURCE = 4;
    public static final int REPOSITORY = 5;
    public static final int SERVER = 6;
    public static final int DOMAIN = 7;
    public static final int DEPLOY = 8;
    public static final int TEAM = 9;
    public static final int SECURITY = 10;

    private static final int TILE = Color.rgb(18, 27, 42);
    private static final int BLUE = Color.rgb(74, 137, 255);
    private static final int VIOLET = Color.rgb(153, 108, 255);
    private static final int GREEN = Color.rgb(58, 200, 132);
    private static final int ORANGE = Color.rgb(255, 167, 66);
    private static final int CYAN = Color.rgb(80, 205, 220);
    private static final int WHITE = Color.rgb(244, 247, 252);

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final int type;
    private int accent;

    public UchihaIconView(Context context, int type) {
        this(context, type, defaultAccent(type));
    }

    public UchihaIconView(Context context, int type, int accent) {
        super(context);
        this.type = type;
        this.accent = accent;
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
    }

    public void setAccent(int value) {
        accent = value;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int fallback = dp(46);
        int width = resolveSize(fallback, widthMeasureSpec);
        int height = resolveSize(fallback, heightMeasureSpec);
        setMeasuredDimension(width, height);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth();
        float h = getHeight();
        float s = Math.min(w, h);
        float ox = (w - s) / 2f;
        float oy = (h - s) / 2f;
        RectF tile = new RectF(ox + s * .05f, oy + s * .05f, ox + s * .95f, oy + s * .95f);

        paint.setStyle(Paint.Style.FILL);
        paint.setColor(TILE);
        canvas.drawRoundRect(tile, s * .25f, s * .25f, paint);

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1f, s * .035f));
        paint.setColor(withAlpha(accent, 145));
        canvas.drawRoundRect(tile, s * .25f, s * .25f, paint);

        canvas.save();
        canvas.translate(ox, oy);
        switch (type) {
            case BRAND: drawBrand(canvas, s); break;
            case PROJECT: drawProject(canvas, s); break;
            case AI: drawAi(canvas, s); break;
            case PREVIEW: drawPreview(canvas, s); break;
            case SOURCE: drawSource(canvas, s); break;
            case REPOSITORY: drawRepository(canvas, s); break;
            case SERVER: drawServer(canvas, s); break;
            case DOMAIN: drawDomain(canvas, s); break;
            case DEPLOY: drawDeploy(canvas, s); break;
            case TEAM: drawTeam(canvas, s); break;
            case SECURITY: drawSecurity(canvas, s); break;
            default: drawProject(canvas, s); break;
        }
        canvas.restore();
    }

    private void drawBrand(Canvas c, float s) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(s * .09f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setColor(VIOLET);
        RectF arc = new RectF(s * .28f, s * .24f, s * .72f, s * .74f);
        c.drawArc(arc, 0, 180, false, paint);
        paint.setColor(BLUE);
        c.drawLine(s * .28f, s * .49f, s * .28f, s * .64f, paint);
        c.drawLine(s * .72f, s * .49f, s * .72f, s * .64f, paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(CYAN);
        c.drawCircle(s * .50f, s * .29f, s * .055f, paint);
    }

    private void drawProject(Canvas c, float s) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(withAlpha(accent, 230));
        RectF body = new RectF(s * .23f, s * .34f, s * .77f, s * .72f);
        c.drawRoundRect(body, s * .08f, s * .08f, paint);
        paint.setColor(CYAN);
        RectF tab = new RectF(s * .28f, s * .27f, s * .49f, s * .39f);
        c.drawRoundRect(tab, s * .05f, s * .05f, paint);
        paint.setColor(WHITE);
        c.drawCircle(s * .66f, s * .54f, s * .045f, paint);
    }

    private void drawAi(Canvas c, float s) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(withAlpha(VIOLET, 235));
        RectF bubble = new RectF(s * .23f, s * .29f, s * .70f, s * .67f);
        c.drawRoundRect(bubble, s * .12f, s * .12f, paint);
        path.reset();
        path.moveTo(s * .34f, s * .64f);
        path.lineTo(s * .30f, s * .76f);
        path.lineTo(s * .45f, s * .66f);
        path.close();
        c.drawPath(path, paint);
        paint.setColor(CYAN);
        c.drawCircle(s * .64f, s * .33f, s * .085f, paint);
        paint.setColor(WHITE);
        c.drawCircle(s * .38f, s * .48f, s * .035f, paint);
        c.drawCircle(s * .50f, s * .48f, s * .035f, paint);
        c.drawCircle(s * .62f, s * .48f, s * .035f, paint);
    }

    private void drawPreview(Canvas c, float s) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(s * .055f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setColor(BLUE);
        RectF phone = new RectF(s * .30f, s * .20f, s * .70f, s * .80f);
        c.drawRoundRect(phone, s * .10f, s * .10f, paint);
        paint.setColor(CYAN);
        RectF eye = new RectF(s * .36f, s * .42f, s * .64f, s * .59f);
        c.drawOval(eye, paint);
        paint.setStyle(Paint.Style.FILL);
        c.drawCircle(s * .50f, s * .505f, s * .055f, paint);
        paint.setColor(WHITE);
        c.drawCircle(s * .50f, s * .72f, s * .025f, paint);
    }

    private void drawSource(Canvas c, float s) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(withAlpha(GREEN, 230));
        RectF doc = new RectF(s * .27f, s * .21f, s * .73f, s * .79f);
        c.drawRoundRect(doc, s * .07f, s * .07f, paint);
        paint.setColor(TILE);
        paint.setStrokeWidth(s * .045f);
        paint.setStyle(Paint.Style.STROKE);
        c.drawLine(s * .39f, s * .40f, s * .34f, s * .50f, paint);
        c.drawLine(s * .34f, s * .50f, s * .39f, s * .60f, paint);
        c.drawLine(s * .61f, s * .40f, s * .66f, s * .50f, paint);
        c.drawLine(s * .66f, s * .50f, s * .61f, s * .60f, paint);
        paint.setColor(WHITE);
        c.drawLine(s * .47f, s * .63f, s * .55f, s * .37f, paint);
    }

    private void drawRepository(Canvas c, float s) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(s * .055f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setColor(CYAN);
        c.drawLine(s * .36f, s * .33f, s * .36f, s * .68f, paint);
        c.drawLine(s * .36f, s * .48f, s * .62f, s * .48f, paint);
        c.drawLine(s * .62f, s * .48f, s * .62f, s * .67f, paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(BLUE);
        c.drawCircle(s * .36f, s * .29f, s * .075f, paint);
        paint.setColor(VIOLET);
        c.drawCircle(s * .36f, s * .72f, s * .075f, paint);
        paint.setColor(GREEN);
        c.drawCircle(s * .62f, s * .72f, s * .075f, paint);
    }

    private void drawServer(Canvas c, float s) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(withAlpha(BLUE, 225));
        RectF one = new RectF(s * .24f, s * .27f, s * .76f, s * .47f);
        RectF two = new RectF(s * .24f, s * .53f, s * .76f, s * .73f);
        c.drawRoundRect(one, s * .06f, s * .06f, paint);
        c.drawRoundRect(two, s * .06f, s * .06f, paint);
        paint.setColor(GREEN);
        c.drawCircle(s * .65f, s * .37f, s * .035f, paint);
        c.drawCircle(s * .65f, s * .63f, s * .035f, paint);
        paint.setColor(WHITE);
        c.drawRoundRect(new RectF(s * .31f, s * .34f, s * .52f, s * .40f), s * .02f, s * .02f, paint);
        c.drawRoundRect(new RectF(s * .31f, s * .60f, s * .52f, s * .66f), s * .02f, s * .02f, paint);
    }

    private void drawDomain(Canvas c, float s) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(s * .045f);
        paint.setColor(GREEN);
        c.drawCircle(s * .50f, s * .50f, s * .25f, paint);
        paint.setColor(CYAN);
        c.drawOval(new RectF(s * .39f, s * .25f, s * .61f, s * .75f), paint);
        c.drawLine(s * .26f, s * .50f, s * .74f, s * .50f, paint);
        c.drawArc(new RectF(s * .29f, s * .34f, s * .71f, s * .66f), 0, 180, false, paint);
        c.drawArc(new RectF(s * .29f, s * .34f, s * .71f, s * .66f), 180, 180, false, paint);
    }

    private void drawDeploy(Canvas c, float s) {
        paint.setStyle(Paint.Style.FILL);
        path.reset();
        path.moveTo(s * .50f, s * .20f);
        path.lineTo(s * .67f, s * .52f);
        path.lineTo(s * .57f, s * .51f);
        path.lineTo(s * .57f, s * .72f);
        path.lineTo(s * .43f, s * .72f);
        path.lineTo(s * .43f, s * .51f);
        path.lineTo(s * .33f, s * .52f);
        path.close();
        paint.setColor(ORANGE);
        c.drawPath(path, paint);
        paint.setColor(VIOLET);
        c.drawRoundRect(new RectF(s * .30f, s * .75f, s * .70f, s * .82f), s * .03f, s * .03f, paint);
        paint.setColor(WHITE);
        c.drawCircle(s * .50f, s * .41f, s * .045f, paint);
    }

    private void drawTeam(Canvas c, float s) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(BLUE);
        c.drawCircle(s * .50f, s * .36f, s * .10f, paint);
        paint.setColor(CYAN);
        c.drawCircle(s * .31f, s * .43f, s * .075f, paint);
        paint.setColor(VIOLET);
        c.drawCircle(s * .69f, s * .43f, s * .075f, paint);
        paint.setColor(withAlpha(BLUE, 220));
        c.drawRoundRect(new RectF(s * .36f, s * .50f, s * .64f, s * .72f), s * .10f, s * .10f, paint);
        paint.setColor(withAlpha(CYAN, 210));
        c.drawRoundRect(new RectF(s * .20f, s * .55f, s * .37f, s * .70f), s * .08f, s * .08f, paint);
        paint.setColor(withAlpha(VIOLET, 210));
        c.drawRoundRect(new RectF(s * .63f, s * .55f, s * .80f, s * .70f), s * .08f, s * .08f, paint);
    }

    private void drawSecurity(Canvas c, float s) {
        paint.setStyle(Paint.Style.FILL);
        path.reset();
        path.moveTo(s * .50f, s * .20f);
        path.lineTo(s * .71f, s * .29f);
        path.lineTo(s * .67f, s * .60f);
        path.quadTo(s * .63f, s * .72f, s * .50f, s * .80f);
        path.quadTo(s * .37f, s * .72f, s * .33f, s * .60f);
        path.lineTo(s * .29f, s * .29f);
        path.close();
        paint.setColor(GREEN);
        c.drawPath(path, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(s * .05f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setColor(WHITE);
        c.drawLine(s * .40f, s * .50f, s * .48f, s * .58f, paint);
        c.drawLine(s * .48f, s * .58f, s * .62f, s * .42f, paint);
    }

    private static int defaultAccent(int type) {
        switch (type) {
            case AI: return VIOLET;
            case PREVIEW: return BLUE;
            case SOURCE: return GREEN;
            case REPOSITORY: return CYAN;
            case SERVER: return BLUE;
            case DOMAIN: return GREEN;
            case DEPLOY: return ORANGE;
            case TEAM: return BLUE;
            case SECURITY: return GREEN;
            case BRAND: return VIOLET;
            default: return BLUE;
        }
    }

    private static int withAlpha(int color, int alpha) {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
