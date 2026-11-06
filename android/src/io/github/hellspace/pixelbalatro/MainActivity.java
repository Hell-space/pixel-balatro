package io.github.hellspace.pixelbalatro;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;

/** Offline game host: one trusted HTTPS origin, no JavaScript bridge or file access. */
public final class MainActivity extends Activity {
  private static final String HOST="game.pixel-balatro.local";
  private WebView web;
  private boolean paused;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    FrameLayout root=new FrameLayout(this);
    root.setBackgroundColor(Color.rgb(16,45,43));
    web=new WebView(this);
    root.addView(web,new FrameLayout.LayoutParams(-1,-1));
    setContentView(root);
    // Keep controls clear of status/navigation bars, including mandatory edge-to-edge on API 35+.
    if(Build.VERSION.SDK_INT>=30){
      getWindow().setDecorFitsSystemWindows(false);
      root.setOnApplyWindowInsetsListener((v,insets)->{
        android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
        v.setPadding(safe.left,safe.top,safe.right,safe.bottom);return WindowInsets.CONSUMED;
      });
    }
    web.setBackgroundColor(Color.rgb(16,45,43));
    WebSettings settings=web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setSupportMultipleWindows(false);
    settings.setMediaPlaybackRequiresUserGesture(true);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setTextZoom(100);
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
        Uri uri=request.getUrl();return !"https".equals(uri.getScheme())||!HOST.equals(uri.getHost());
      }
      @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
        Uri uri=request.getUrl();
        if(!HOST.equals(uri.getHost()))return null;
        if("https".equals(uri.getScheme())&&"/balatro.html".equals(uri.getPath())){
          try{return new WebResourceResponse("text/html","UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),getAssets().open("balatro.html"));}
          catch(IOException ignored){}
        }
        return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
      }
      @Override public void onPageFinished(WebView view,String url){
        if(paused)pauseGame();
      }
    });
    if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::gameBack);
    web.loadUrl("https://"+HOST+"/balatro.html");
  }
  private void gameBack(){
    web.evaluateJavascript("typeof nativeBack==='function'?nativeBack():true",result->{
      if("true".equals(result))moveTaskToBack(true);
    });
  }
  @Override public void onBackPressed(){gameBack();}
  private void pauseGame(){
    web.evaluateJavascript("if(typeof persistRun==='function')persistRun();if(typeof actx!=='undefined'&&actx)actx.suspend();",null);
  }
  @Override protected void onPause(){paused=true;pauseGame();web.onPause();super.onPause();}
  @Override protected void onResume(){super.onResume();paused=false;if(web!=null){web.onResume();web.evaluateJavascript("if(typeof actx!=='undefined'&&actx)actx.resume();",null);}}
  @Override protected void onDestroy(){if(web!=null){((FrameLayout)web.getParent()).removeView(web);web.destroy();web=null;}super.onDestroy();}
}
